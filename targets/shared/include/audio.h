#pragma once

enum {
	GEA_EMBEDDED_OSCILLATOR_SINE = 0,
	GEA_EMBEDDED_OSCILLATOR_SQUARE = 1,
	GEA_EMBEDDED_OSCILLATOR_SAWTOOTH = 2,
	GEA_EMBEDDED_OSCILLATOR_TRIANGLE = 3,
};

double gea_embedded_audio_context_current_time(void);
int gea_embedded_audio_context_destination(void);
int gea_embedded_audio_context_create_oscillator(void);
int gea_embedded_audio_get_volume(void);
void gea_embedded_audio_set_volume(int volume_percent);
void gea_embedded_audio_oscillator_set_type(int oscillator_id, int type);
double gea_embedded_audio_oscillator_get_frequency(int oscillator_id);
void gea_embedded_audio_oscillator_set_frequency(int oscillator_id, double frequency_hz);
void gea_embedded_audio_oscillator_frequency_set_value_at_time(int oscillator_id, double frequency_hz, double start_time);
void gea_embedded_audio_oscillator_connect(int oscillator_id, int destination_id);
void gea_embedded_audio_oscillator_start(int oscillator_id, double when);
void gea_embedded_audio_oscillator_stop(int oscillator_id, double when);
