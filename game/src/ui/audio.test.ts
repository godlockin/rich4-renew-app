import { afterEach, describe, expect, it, vi } from 'vitest';
import { boardVoice, characterVoice, voiceOf } from './audio';
import { holidayMusic } from './holidays';
import { pack } from '../core/date';
import { EVENT_LINES } from './lines';

describe('voices (docs/rules/12 §3)', () => {
  it('finds the screens\' lines by their text, also filled-in ones', () => {
    expect(voiceOf('歡迎光臨\n道具店！')).toBe(5);
    expect(voiceOf('現在馬上為您\n開出這一期的\n號碼……')).toBe(18);
    expect(voiceOf('嗨！\n又到了每月\n十五號樂透\n開獎時間∼')).toBe(17);
    expect(voiceOf('底價12000元\n請意者出價。')).toBe(132);
    expect(voiceOf('沒有這句')).toBeUndefined();
  });
  it('gives each character its own voice for the same slot', () => {
    expect(characterVoice(0, EVENT_LINES[0][14])).toBe(1064);
    expect(characterVoice(1, EVENT_LINES[1][0])).toBe(1077);
  });
  it('numbers the news and fate boards', () => {
    expect(boardVoice('news', 4, 0)).toBe(153);
    expect(boardVoice('fate', 12, 0)).toBe(197);
    expect(boardVoice('fate', 33, 2)).toBe(226);
  });
});

describe('holiday music (01 §4.4)', () => {
  it('plays MIDI14-1 on 12/25 for one day on the four original maps', () => {
    expect(holidayMusic(pack(2026, 12, 25), 3)).toEqual({ music: 13, days: 1 });
    expect(holidayMusic(pack(2026, 12, 25), 5)).toBeNull();
  });
  it('plays MIDI14-2 for three days from the lunar new year in Taiwan and China', () => {
    expect(holidayMusic(pack(2026, 2, 17), 0)).toEqual({ music: 14, days: 3 });
    expect(holidayMusic(pack(2026, 2, 17), 2)).toBeNull();
    expect(holidayMusic(pack(2026, 2, 18), 1)).toBeNull();
  });
});

describe('streaming BGM playback', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('streams BGM via HTMLAudioElement without decoding PCM AudioBuffers', async () => {
    vi.resetModules();
    const created: { src: string; loop: boolean; paused: boolean; playCalls: number; volume: number; muted: boolean; onended: (() => void) | null }[] = [];
    class FakeAudio {
      src = '';
      preload = '';
      loop = false;
      paused = true;
      volume = 1;
      muted = false;
      currentTime = 0;
      duration = 120;
      playCalls = 0;
      onended: (() => void) | null = null;
      ontimeupdate: (() => void) | null = null;
      onloadedmetadata: (() => void) | null = null;
      constructor() { created.push(this); }
      play() { this.paused = false; this.playCalls++; return Promise.resolve(); }
      pause() { this.paused = true; }
      removeAttribute(k: string) { if (k === 'src') this.src = ''; }
      load() {}
    }
    class FakeCtx {
      state = 'running';
      currentTime = 0;
      destination = {};
      createGain() { return { gain: { value: 1, setTargetAtTime() {} }, connect: (n: unknown) => n }; }
      createBuffer() { return {}; }
      createBufferSource() { return { connect: (n: unknown) => n, start() {}, stop() {}, buffer: null }; }
      decodeAudioData() { throw new Error('BGM must not call decodeAudioData'); }
    }
    vi.stubGlobal('Audio', FakeAudio);
    vi.stubGlobal('window', { AudioContext: FakeCtx, addEventListener() {}, removeEventListener() {} });
    vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} });
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));

    const { audio } = await import('./audio');
    audio.background(1);
    expect(created).toHaveLength(1);
    expect(created[0]!.src).toContain('music/rich08.m4a');
    expect(created[0]!.playCalls).toBe(1);
    expect(created[0]!.loop).toBe(false);
    expect(audio.memStats()).toEqual({ buffers: 0, bytes: 0, music: 0, musicBytes: 0 });

    audio.theme(0);
    expect(created[0]!.loop).toBe(true);
    expect(created[0]!.src).toContain('music/midi01.m4a');

    audio.stopMusic();
    expect(created[0]!.paused).toBe(true);
    expect(created[0]!.src).toBe('');
  });
});
