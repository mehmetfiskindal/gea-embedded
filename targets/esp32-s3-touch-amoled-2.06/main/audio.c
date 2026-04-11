#include "audio.h"
#include "touch.h"

#include <stdint.h>

#include "driver/gpio.h"
#include "driver/i2s_std.h"
#include "esp_codec_dev.h"
#include "esp_codec_dev_defaults.h"
#include "esp_attr.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"

static const char *TAG = "audio";

#define AUDIO_SAMPLE_RATE 16000
#define AUDIO_CHANNELS 2
#define AUDIO_QUEUE_DEPTH 16
#define AUDIO_TASK_STACK 4096
#define AUDIO_DMA_DESC_NUM 2
#define AUDIO_DMA_FRAME_NUM 64
#define AUDIO_CHUNK_SAMPLES 64
#define AUDIO_AMPLITUDE 5200
#define AUDIO_DEFAULT_VOLUME 100
#define AUDIO_MAX_OSCILLATORS 8
#define AUDIO_MAX_ACTIVE_TONES 12
#define AUDIO_MAX_TONE_MS 2500
#define AUDIO_WRITE_TIMEOUT_MS 20
#define AUDIO_DROP_LOG_INTERVAL_US 1000000

#define AUDIO_I2S_NUM I2S_NUM_AUTO
#define AUDIO_PIN_MCLK GPIO_NUM_16
#define AUDIO_PIN_BCLK GPIO_NUM_41
#define AUDIO_PIN_WS GPIO_NUM_45
#define AUDIO_PIN_DOUT GPIO_NUM_40
#define AUDIO_PIN_DIN GPIO_NUM_42
#define AUDIO_PIN_PA GPIO_NUM_46

typedef struct {
	int type;
	double frequency_hz;
	int duration_ms;
	int delay_ms;
} audio_tone_t;

typedef struct {
	int in_use;
	int type;
	double frequency_hz;
	int connected;
	int started;
	double start_time;
} audio_oscillator_t;

typedef struct {
	int in_use;
	int type;
	uint32_t phase;
	uint32_t phase_step;
	int total_samples;
	int sample_index;
	int delay_samples;
} audio_active_tone_t;

static QueueHandle_t tone_queue = NULL;
static TaskHandle_t audio_task_handle = NULL;
static i2s_chan_handle_t i2s_tx_chan = NULL;
static const audio_codec_data_if_t *i2s_data_if = NULL;
static esp_codec_dev_handle_t speaker_codec = NULL;
static int i2s_channel_enabled = 0;
static int speaker_open = 0;
static audio_oscillator_t oscillators[AUDIO_MAX_OSCILLATORS];
static audio_active_tone_t active_tones[AUDIO_MAX_ACTIVE_TONES];
static int next_oscillator_id = 0;
static int audio_volume = AUDIO_DEFAULT_VOLUME;
static int64_t last_drop_log_us = 0;
static DRAM_ATTR StaticQueue_t tone_queue_storage;
static DRAM_ATTR uint8_t tone_queue_buffer[AUDIO_QUEUE_DEPTH * sizeof(audio_tone_t)];
static DRAM_ATTR StaticTask_t audio_task_tcb;
static DRAM_ATTR StackType_t audio_task_stack[AUDIO_TASK_STACK];
static int audio_task_failure_logged = 0;

static void audio_task(void *arg);

static void audio_release_i2s(void)
{
	if (i2s_tx_chan) {
		if (i2s_channel_enabled) {
			i2s_channel_disable(i2s_tx_chan);
			i2s_channel_enabled = 0;
		}
		i2s_del_channel(i2s_tx_chan);
		i2s_tx_chan = NULL;
	}
	i2s_data_if = NULL;
}

static esp_err_t audio_init_i2s(void)
{
	if (i2s_tx_chan && i2s_data_if) return ESP_OK;

	i2s_chan_config_t chan_cfg = I2S_CHANNEL_DEFAULT_CONFIG(AUDIO_I2S_NUM, I2S_ROLE_MASTER);
	chan_cfg.auto_clear = true;
	chan_cfg.dma_desc_num = AUDIO_DMA_DESC_NUM;
	chan_cfg.dma_frame_num = AUDIO_DMA_FRAME_NUM;
	esp_err_t err = i2s_new_channel(&chan_cfg, &i2s_tx_chan, NULL);
	if (err != ESP_OK) {
		ESP_LOGE(TAG, "I2S channel creation failed: %s", esp_err_to_name(err));
		return err;
	}
	ESP_LOGI(TAG, "I2S TX channel allocated for PCM audio");

	i2s_std_config_t std_cfg = {
		.clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(AUDIO_SAMPLE_RATE),
		.slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO),
		.gpio_cfg = {
			.mclk = AUDIO_PIN_MCLK,
			.bclk = AUDIO_PIN_BCLK,
			.ws = AUDIO_PIN_WS,
			.dout = AUDIO_PIN_DOUT,
			.din = AUDIO_PIN_DIN,
			.invert_flags = {
				.mclk_inv = false,
				.bclk_inv = false,
				.ws_inv = false,
			},
		},
	};

	err = i2s_channel_init_std_mode(i2s_tx_chan, &std_cfg);
	if (err != ESP_OK) {
		ESP_LOGE(TAG, "I2S std init failed: %s", esp_err_to_name(err));
		audio_release_i2s();
		return err;
	}

	err = i2s_channel_enable(i2s_tx_chan);
	if (err != ESP_OK) {
		ESP_LOGE(TAG, "I2S enable failed: %s", esp_err_to_name(err));
		audio_release_i2s();
		return err;
	}
	i2s_channel_enabled = 1;

	audio_codec_i2s_cfg_t i2s_cfg = {
		.tx_handle = i2s_tx_chan,
		.rx_handle = NULL,
	};
	i2s_data_if = audio_codec_new_i2s_data(&i2s_cfg);
	if (!i2s_data_if) {
		ESP_LOGE(TAG, "I2S codec data interface creation failed");
		audio_release_i2s();
		return ESP_ERR_NO_MEM;
	}

	return ESP_OK;
}

static esp_err_t audio_init_speaker(void)
{
	if (speaker_codec) return ESP_OK;

	esp_err_t err = audio_init_i2s();
	if (err != ESP_OK) return err;

	gpio_config_t pa_cfg = {
		.pin_bit_mask = 1ULL << AUDIO_PIN_PA,
		.mode = GPIO_MODE_OUTPUT,
	};
	gpio_config(&pa_cfg);
	gpio_set_level(AUDIO_PIN_PA, 1);

	i2c_master_bus_handle_t i2c_bus = gea_embedded_touch_get_i2c_bus();
	if (!i2c_bus) {
		ESP_LOGE(TAG, "I2C bus is not ready for ES8311");
		return ESP_ERR_INVALID_STATE;
	}

	audio_codec_i2c_cfg_t i2c_cfg = {
		.addr = ES8311_CODEC_DEFAULT_ADDR,
		.bus_handle = i2c_bus,
	};
	const audio_codec_ctrl_if_t *i2c_ctrl_if = audio_codec_new_i2c_ctrl(&i2c_cfg);
	if (!i2c_ctrl_if) {
		ESP_LOGE(TAG, "ES8311 I2C control interface creation failed");
		return ESP_ERR_NO_MEM;
	}

	const audio_codec_gpio_if_t *gpio_if = audio_codec_new_gpio();
	if (!gpio_if) {
		ESP_LOGE(TAG, "Codec GPIO interface creation failed");
		return ESP_ERR_NO_MEM;
	}

	esp_codec_dev_hw_gain_t gain = {
		.pa_voltage = 5.0,
		.codec_dac_voltage = 3.3,
	};
	es8311_codec_cfg_t es8311_cfg = {
		.ctrl_if = i2c_ctrl_if,
		.gpio_if = gpio_if,
		.codec_mode = ESP_CODEC_DEV_WORK_MODE_DAC,
		.pa_pin = AUDIO_PIN_PA,
		.pa_reverted = false,
		.master_mode = false,
		.use_mclk = true,
		.digital_mic = false,
		.invert_mclk = false,
		.invert_sclk = false,
		.hw_gain = gain,
	};

	const audio_codec_if_t *codec_if = es8311_codec_new(&es8311_cfg);
	if (!codec_if) {
		ESP_LOGE(TAG, "ES8311 codec interface creation failed");
		return ESP_ERR_NO_MEM;
	}

	esp_codec_dev_cfg_t codec_cfg = {
		.dev_type = ESP_CODEC_DEV_TYPE_OUT,
		.codec_if = codec_if,
		.data_if = i2s_data_if,
	};
	speaker_codec = esp_codec_dev_new(&codec_cfg);
	if (!speaker_codec) {
		ESP_LOGE(TAG, "Speaker codec device creation failed");
		return ESP_ERR_NO_MEM;
	}

	return ESP_OK;
}

static esp_err_t audio_open_speaker(void)
{
	if (speaker_open) return ESP_OK;

	esp_err_t err = audio_init_speaker();
	if (err != ESP_OK) {
		ESP_LOGE(TAG, "Speaker init failed: %s", esp_err_to_name(err));
		return err;
	}

	esp_codec_dev_sample_info_t sample_info = {
		.sample_rate = AUDIO_SAMPLE_RATE,
		.channel = AUDIO_CHANNELS,
		.bits_per_sample = 16,
	};
	ESP_LOGI(TAG, "Opening ES8311 speaker for PCM effects");
	err = esp_codec_dev_open(speaker_codec, &sample_info);
	if (err != ESP_OK) {
		ESP_LOGE(TAG, "Speaker open failed: %s", esp_err_to_name(err));
		return err;
	}

	esp_codec_dev_set_out_vol(speaker_codec, audio_volume);
	speaker_open = 1;
	ESP_LOGI(TAG, "ES8311 speaker ready for PCM effects");
	return ESP_OK;
}

int gea_embedded_audio_get_volume(void)
{
	return audio_volume;
}

void gea_embedded_audio_set_volume(int volume_percent)
{
	if (volume_percent < 0) volume_percent = 0;
	if (volume_percent > 100) volume_percent = 100;
	audio_volume = volume_percent;
	if (speaker_open && speaker_codec) {
		esp_codec_dev_set_out_vol(speaker_codec, audio_volume);
	}
}

static int tone_envelope(int sample_index, int remaining_samples)
{
	const int attack_samples = 80;
	const int release_samples = 180;
	int level = 256;
	if (sample_index < attack_samples) level = (sample_index * 256) / attack_samples;
	if (remaining_samples < release_samples) {
		int release_level = (remaining_samples * 256) / release_samples;
		if (release_level < level) level = release_level;
	}
	if (level < 0) return 0;
	if (level > 256) return 256;
	return level;
}

static int waveform_sample(int type, uint32_t phase)
{
	if (type == GEA_EMBEDDED_OSCILLATOR_SQUARE) {
		return (phase & 0x80000000u) ? AUDIO_AMPLITUDE : -AUDIO_AMPLITUDE;
	}

	uint32_t pos = phase >> 16;
	if (type == GEA_EMBEDDED_OSCILLATOR_SAWTOOTH) {
		return (((int)pos - 32768) * AUDIO_AMPLITUDE) / 32768;
	}

	if (pos < 32768) {
		return -AUDIO_AMPLITUDE + ((int)pos * AUDIO_AMPLITUDE * 2) / 32768;
	}
	return AUDIO_AMPLITUDE - (((int)pos - 32768) * AUDIO_AMPLITUDE * 2) / 32768;
}

static int audio_clamp_sample(int sample)
{
	if (sample > 32767) return 32767;
	if (sample < -32768) return -32768;
	return sample;
}

static void audio_normalize_tone(audio_tone_t *tone)
{
	if (tone->frequency_hz < 40.0) tone->frequency_hz = 40.0;
	if (tone->frequency_hz > 4000.0) tone->frequency_hz = 4000.0;
	if (tone->duration_ms < 10) tone->duration_ms = 10;
	if (tone->duration_ms > AUDIO_MAX_TONE_MS) tone->duration_ms = AUDIO_MAX_TONE_MS;
	if (tone->delay_ms < 0) tone->delay_ms = 0;
}

static int audio_active_tone_remaining(const audio_active_tone_t *tone)
{
	if (!tone->in_use) return 0;
	int remaining = tone->total_samples - tone->sample_index;
	if (remaining < 0) remaining = 0;
	return tone->delay_samples + remaining;
}

static int audio_has_active_tones(void)
{
	for (int i = 0; i < AUDIO_MAX_ACTIVE_TONES; i++) {
		if (active_tones[i].in_use) return 1;
	}
	return 0;
}

static void audio_add_active_tone(audio_tone_t tone)
{
	audio_normalize_tone(&tone);

	int total_samples = (AUDIO_SAMPLE_RATE * tone.duration_ms) / 1000;
	if (total_samples <= 0) return;

	int slot = -1;
	int shortest_remaining = INT32_MAX;
	for (int i = 0; i < AUDIO_MAX_ACTIVE_TONES; i++) {
		if (!active_tones[i].in_use) {
			slot = i;
			break;
		}
		int remaining = audio_active_tone_remaining(&active_tones[i]);
		if (remaining < shortest_remaining) {
			shortest_remaining = remaining;
			slot = i;
		}
	}

	active_tones[slot] = (audio_active_tone_t) {
		.in_use = 1,
		.type = tone.type,
		.phase = 0,
		.phase_step = (uint32_t)((tone.frequency_hz * 4294967296.0) / AUDIO_SAMPLE_RATE),
		.total_samples = total_samples,
		.sample_index = 0,
		.delay_samples = (AUDIO_SAMPLE_RATE * tone.delay_ms) / 1000,
	};
}

static void audio_render_chunk(int16_t *pcm, int samples)
{
	for (int i = 0; i < samples; i++) {
		int mixed = 0;
		for (int voice = 0; voice < AUDIO_MAX_ACTIVE_TONES; voice++) {
			audio_active_tone_t *tone = &active_tones[voice];
			if (!tone->in_use) continue;

			if (tone->delay_samples > 0) {
				tone->delay_samples--;
				continue;
			}

			int remaining = tone->total_samples - tone->sample_index;
			if (remaining <= 0) {
				tone->in_use = 0;
				continue;
			}

			int level = tone_envelope(tone->sample_index, remaining);
			mixed += (waveform_sample(tone->type, tone->phase) * level) / 256;
			tone->phase += tone->phase_step;
			tone->sample_index++;
			if (tone->sample_index >= tone->total_samples) {
				tone->in_use = 0;
			}
		}

		int16_t sample = (int16_t)audio_clamp_sample(mixed);
		for (int ch = 0; ch < AUDIO_CHANNELS; ch++) {
			pcm[i * AUDIO_CHANNELS + ch] = sample;
		}
	}
}

static void ensure_audio_task(void)
{
	if (!tone_queue) {
		tone_queue = xQueueCreateStatic(AUDIO_QUEUE_DEPTH, sizeof(audio_tone_t), tone_queue_buffer, &tone_queue_storage);
		if (!tone_queue) {
			ESP_LOGE(TAG, "Tone queue creation failed");
			return;
		}
	}

	if (!audio_task_handle) {
		audio_task_handle = xTaskCreateStatic(audio_task, "audio", AUDIO_TASK_STACK, NULL, 6, audio_task_stack, &audio_task_tcb);
		if (!audio_task_handle) {
			if (!audio_task_failure_logged) {
				audio_task_failure_logged = 1;
				ESP_LOGE(TAG, "Audio task creation failed");
			}
		} else {
			audio_task_failure_logged = 0;
			ESP_LOGI(TAG, "Audio task started");
		}
	}
}

static void audio_task(void *arg)
{
	(void)arg;
	audio_tone_t tone;
	int16_t pcm[AUDIO_CHUNK_SAMPLES * AUDIO_CHANNELS];

	while (1) {
		if (!audio_has_active_tones()) {
			if (xQueueReceive(tone_queue, &tone, portMAX_DELAY) == pdTRUE) {
				audio_add_active_tone(tone);
			}
		}

		while (xQueueReceive(tone_queue, &tone, 0) == pdTRUE) {
			audio_add_active_tone(tone);
		}

		if (!audio_has_active_tones()) continue;
		if (audio_open_speaker() != ESP_OK) {
			vTaskDelay(pdMS_TO_TICKS(50));
			continue;
		}

		audio_render_chunk(pcm, AUDIO_CHUNK_SAMPLES);

		size_t bytes_written = 0;
		esp_err_t err = i2s_channel_write(i2s_tx_chan, pcm, sizeof(pcm), &bytes_written, pdMS_TO_TICKS(AUDIO_WRITE_TIMEOUT_MS));
		if (err != ESP_OK || bytes_written == 0) {
			ESP_LOGW(TAG, "PCM write failed: %s (%u bytes)", esp_err_to_name(err), (unsigned)bytes_written);
			vTaskDelay(pdMS_TO_TICKS(10));
		}
	}
}

double gea_embedded_audio_context_current_time(void)
{
	return (double)esp_timer_get_time() / 1000000.0;
}

int gea_embedded_audio_context_destination(void)
{
	return 0;
}

int gea_embedded_audio_context_create_oscillator(void)
{
	int id = next_oscillator_id;
	next_oscillator_id = (next_oscillator_id + 1) % AUDIO_MAX_OSCILLATORS;
	oscillators[id].in_use = 1;
	oscillators[id].type = GEA_EMBEDDED_OSCILLATOR_SINE;
	oscillators[id].frequency_hz = 440.0;
	oscillators[id].connected = 0;
	oscillators[id].started = 0;
	oscillators[id].start_time = 0.0;
	return id;
}

static audio_oscillator_t *audio_oscillator(int oscillator_id)
{
	if (oscillator_id < 0 || oscillator_id >= AUDIO_MAX_OSCILLATORS) return NULL;
	if (!oscillators[oscillator_id].in_use) return NULL;
	return &oscillators[oscillator_id];
}

void gea_embedded_audio_oscillator_set_type(int oscillator_id, int type)
{
	audio_oscillator_t *osc = audio_oscillator(oscillator_id);
	if (!osc) return;
	if (type < GEA_EMBEDDED_OSCILLATOR_SINE || type > GEA_EMBEDDED_OSCILLATOR_TRIANGLE)
		type = GEA_EMBEDDED_OSCILLATOR_SINE;
	osc->type = type;
}

double gea_embedded_audio_oscillator_get_frequency(int oscillator_id)
{
	audio_oscillator_t *osc = audio_oscillator(oscillator_id);
	return osc ? osc->frequency_hz : 0.0;
}

void gea_embedded_audio_oscillator_set_frequency(int oscillator_id, double frequency_hz)
{
	audio_oscillator_t *osc = audio_oscillator(oscillator_id);
	if (!osc) return;
	osc->frequency_hz = frequency_hz;
}

void gea_embedded_audio_oscillator_frequency_set_value_at_time(int oscillator_id, double frequency_hz, double start_time)
{
	(void)start_time;
	gea_embedded_audio_oscillator_set_frequency(oscillator_id, frequency_hz);
}

void gea_embedded_audio_oscillator_connect(int oscillator_id, int destination_id)
{
	(void)destination_id;
	audio_oscillator_t *osc = audio_oscillator(oscillator_id);
	if (!osc) return;
	osc->connected = 1;
}

void gea_embedded_audio_oscillator_start(int oscillator_id, double when)
{
	audio_oscillator_t *osc = audio_oscillator(oscillator_id);
	if (!osc) return;
	if (when <= 0.0) when = gea_embedded_audio_context_current_time();
	osc->start_time = when;
	osc->started = 1;
}

void gea_embedded_audio_oscillator_stop(int oscillator_id, double when)
{
	audio_oscillator_t *osc = audio_oscillator(oscillator_id);
	if (!osc || !osc->connected) return;

	double now = gea_embedded_audio_context_current_time();
	double start_time = osc->started ? osc->start_time : now;
	if (when <= 0.0) when = now;
	if (when < start_time) when = start_time;

	int duration_ms = (int)((when - start_time) * 1000.0 + 0.5);
	int delay_ms = start_time > now ? (int)((start_time - now) * 1000.0 + 0.5) : 0;
	if (duration_ms <= 0) return;

	audio_tone_t tone = {
		.type = osc->type,
		.frequency_hz = osc->frequency_hz,
		.duration_ms = duration_ms,
		.delay_ms = delay_ms,
	};

	ensure_audio_task();
	if (!tone_queue) return;
	if (xQueueSend(tone_queue, &tone, 0) != pdPASS) {
		int64_t now_us = esp_timer_get_time();
		if (now_us - last_drop_log_us > AUDIO_DROP_LOG_INTERVAL_US) {
			last_drop_log_us = now_us;
			ESP_LOGW(TAG, "Tone queue full; dropping tone");
		}
	}
}
