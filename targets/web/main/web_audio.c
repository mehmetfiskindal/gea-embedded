#include <emscripten.h>

#include "audio.h"

EM_JS(double, gea_embedded_audio_context_current_time, (void), {
  try {
    var AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextCtor) return 0;
    var ctx = globalThis.__gea_embedded_audio_ctx;
    if (!ctx) ctx = globalThis.__gea_embedded_audio_ctx = new AudioContextCtor();
    return ctx.currentTime || 0;
  } catch (e) {
    return 0;
  }
});

EM_JS(int, gea_embedded_audio_context_destination, (void), {
  return 0;
});

EM_JS(int, gea_embedded_audio_context_create_oscillator, (void), {
  try {
    var AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextCtor) return -1;
    var ctx = globalThis.__gea_embedded_audio_ctx;
    if (!ctx) ctx = globalThis.__gea_embedded_audio_ctx = new AudioContextCtor();
    var nodes = globalThis.__gea_embedded_audio_oscillators;
    if (!nodes) nodes = globalThis.__gea_embedded_audio_oscillators = [];
    var oscillator = ctx.createOscillator();
    var id = nodes.length;
    nodes.push({ oscillator: oscillator, connected: false, started: false });
    return id;
  } catch (e) {
    return -1;
  }
});

EM_JS(int, gea_embedded_audio_get_volume, (void), {
  var volume = globalThis.__gea_embedded_audio_volume;
  if (typeof volume !== 'number') {
    volume = 100;
    globalThis.__gea_embedded_audio_volume = volume;
  }
  return volume | 0;
});

EM_JS(void, gea_embedded_audio_set_volume, (int volume_percent), {
  if (volume_percent < 0) volume_percent = 0;
  if (volume_percent > 100) volume_percent = 100;
  globalThis.__gea_embedded_audio_volume = volume_percent;

  var ctx = globalThis.__gea_embedded_audio_ctx;
  var gain = globalThis.__gea_embedded_audio_gain;
  if (ctx && gain) gain.gain.setValueAtTime(volume_percent / 100, ctx.currentTime || 0);
});

EM_JS(void, gea_embedded_audio_oscillator_set_type, (int oscillator_id, int type), {
  var nodes = globalThis.__gea_embedded_audio_oscillators;
  var entry = nodes && nodes[oscillator_id];
  if (!entry || !entry.oscillator) return;
  entry.oscillator.type = type === 1 ? 'square' : type === 2 ? 'sawtooth' : type === 3 ? 'triangle' : 'sine';
});

EM_JS(double, gea_embedded_audio_oscillator_get_frequency, (int oscillator_id), {
  var nodes = globalThis.__gea_embedded_audio_oscillators;
  var entry = nodes && nodes[oscillator_id];
  if (!entry || !entry.oscillator) return 0;
  return entry.oscillator.frequency.value || 0;
});

EM_JS(void, gea_embedded_audio_oscillator_set_frequency, (int oscillator_id, double frequency_hz), {
  var nodes = globalThis.__gea_embedded_audio_oscillators;
  var entry = nodes && nodes[oscillator_id];
  if (!entry || !entry.oscillator) return;
  entry.oscillator.frequency.value = frequency_hz;
});

EM_JS(void, gea_embedded_audio_oscillator_frequency_set_value_at_time, (int oscillator_id, double frequency_hz, double start_time), {
  var nodes = globalThis.__gea_embedded_audio_oscillators;
  var entry = nodes && nodes[oscillator_id];
  if (!entry || !entry.oscillator) return;
  entry.oscillator.frequency.setValueAtTime(frequency_hz, start_time);
});

EM_JS(void, gea_embedded_audio_oscillator_connect, (int oscillator_id, int destination_id), {
  destination_id;
  try {
    var ctx = globalThis.__gea_embedded_audio_ctx;
    var nodes = globalThis.__gea_embedded_audio_oscillators;
    var entry = nodes && nodes[oscillator_id];
    if (!ctx || !entry || !entry.oscillator || entry.connected) return;
    var gain = globalThis.__gea_embedded_audio_gain;
    if (!gain) {
      gain = globalThis.__gea_embedded_audio_gain = ctx.createGain();
      var volume = globalThis.__gea_embedded_audio_volume;
      if (typeof volume !== 'number') {
        volume = 100;
        globalThis.__gea_embedded_audio_volume = volume;
      }
      gain.gain.value = volume / 100;
      gain.connect(ctx.destination);
    }
    entry.oscillator.connect(gain);
    entry.connected = true;
  } catch (e) {
  }
});

EM_JS(void, gea_embedded_audio_oscillator_start, (int oscillator_id, double when), {
  try {
    var ctx = globalThis.__gea_embedded_audio_ctx;
    var nodes = globalThis.__gea_embedded_audio_oscillators;
    var entry = nodes && nodes[oscillator_id];
    if (!ctx || !entry || !entry.oscillator || entry.started) return;
    if (ctx.state === 'suspended') ctx.resume();
    entry.oscillator.start(when);
    entry.started = true;
  } catch (e) {
  }
});

EM_JS(void, gea_embedded_audio_oscillator_stop, (int oscillator_id, double when), {
  try {
    var nodes = globalThis.__gea_embedded_audio_oscillators;
    var entry = nodes && nodes[oscillator_id];
    if (!entry || !entry.oscillator || entry.stopped) return;
    entry.oscillator.stop(when);
    entry.stopped = true;
  } catch (e) {
  }
});
