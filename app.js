'use strict';

const $ = id => document.getElementById(id);

let ctx, beatBuffer, beatLabel = '', beatSource = null,
    playStart = 0, pausedAt = 0, playing = false,
    recorder = null, stream = null, recordStart = 0,
    recordChunks = [], recording = false, tracks = [],
    previewSource = null, previewAudio = null;

let countdownActive = false;

const fmt = t => {
  t = Math.max(0, Math.floor(t || 0));
  return String(Math.floor(t / 60)).padStart(2, '0')
    + ':' + String(t % 60).padStart(2, '0');
};

const status = s => $('status').textContent = s;

const audio = () => ctx || (
  ctx = new (window.AudioContext || window.webkitAudioContext)()
);

const position = () => playing
  ? Math.min(beatBuffer?.duration || 0, pausedAt + audio().currentTime - playStart)
  : pausedAt;

function haltBeat() {
  if (beatSource) {
    try { beatSource.stop(); } catch {}
    beatSource.disconnect();
    beatSource = null;
  }
  playing = false;
}

function stopPreview() {
  if (previewSource) {
    try { previewSource.stop(); } catch {}
    previewSource = null;
  }
  if (previewAudio) {
    previewAudio.pause();
    previewAudio = null;
  }
}

async function loadBeat(blob, name) {
  if (recording || countdownActive) {
    return status('녹음을 먼저 종료하세요.');
  }

  haltBeat();
  stopPreview();

  const c = audio();
  await c.resume();

  try {
    beatBuffer = await c.decodeAudioData(await blob.arrayBuffer());
    pausedAt = 0;
    tracks = [];
    beatLabel = name;

    $('beatName').textContent = '선택한 비트: ' + name;
    $('duration').textContent = fmt(beatBuffer.duration);

    renderTracks();
    status('비트 준비 완료! 원하는 구간으로 이동해 녹음하세요.');
  } catch (e) {
    status('비트를 읽지 못했어요: ' + e.message);
  }
}

function startBeat(at = pausedAt) {
  if (!beatBuffer) {
    return status('비트를 먼저 선택하세요.');
  }

  haltBeat();

  const c = audio();
  beatSource = c.createBufferSource();
  beatSource.buffer = beatBuffer;

  const gain = c.createGain();
  gain.gain.value = Number($('beatGain').value) / 100;

  beatSource.connect(gain).connect(c.destination);

  pausedAt = Math.min(at, beatBuffer.duration - .001);
  playStart = c.currentTime;

  beatSource.start(0, pausedAt);
  playing = true;

  beatSource.onended = () => {
    if (playing && position() >= beatBuffer.duration - .05) {
      playing = false;
      pausedAt = 0;
    }
  };
}

function pauseBeat() {
  if (playing) {
    const p = position();
    haltBeat();
    pausedAt = p;
  }
}

$('play').onclick = async () => {
  if (recording || countdownActive) return;
  await audio().resume();
  playing ? pauseBeat() : startBeat();
};

$('reset').onclick = () => {
  if (recording || countdownActive) return;
  pauseBeat();
  pausedAt = 0;
  updateClock();
};

$('seek').oninput = e => {
  if (!beatBuffer || recording || countdownActive) return;

  const p = beatBuffer.duration * Number(e.target.value) / 1000;
  const was = playing;

  pauseBeat();
  pausedAt = p;

  if (was) startBeat(p);
};

function updateClock() {
  const p = position();
  $('clock').textContent = fmt(p);

  if (beatBuffer) {
    $('seek').value = String(
      Math.round(1000 * p / beatBuffer.duration)
    );
  }

  requestAnimationFrame(updateClock);
}

updateClock();

// 직접 파일 선택
$('beatFile').onchange = e => {
  const f = e.target.files?.[0];
  if (f) loadBeat(f, f.name);
};

// 구글 드라이브 비트 목록
$('refresh').onclick = loadCatalog;

async function loadCatalog() {
  const url = window.GILRO_CONFIG?.catalogUrl;

  if (!url) {
    return status('Drive 목록 연동 전입니다. 테스트용 비트를 직접 선택하세요.');
  }

  status('비트 목록을 불러오는 중...');

  try {
    const r = await fetch(url);
    const j = await r.json();

    if (!j.ok) {
      throw Error(j.error || '목록 조회 실패');
    }

    $('beats').replaceChildren(
      new Option('비트를 선택하세요', ''),
      ...j.beats.map(b => new Option(b.name, b.id))
    );

    window.catalog = j.beats;

    status(`${j.beats.length}개의 비트를 찾았습니다.`);
  } catch (e) {
    status('목록 연결 실패: ' + e.message);
  }
}

// GitHub Pages에서 비트 파일 불러오기
$('beats').onchange = async e => {
  const b = window.catalog?.find(x => x.id === e.target.value);
  if (!b) return;

  if (recording || countdownActive) {
    return status('녹음을 먼저 종료하세요.');
  }

  status('비트를 불러오는 중...');

  try {
    const audioUrl = 'beats/' + encodeURIComponent(b.name);
    const r = await fetch(audioUrl);

    if (!r.ok) {
      throw Error('오디오 다운로드 실패 (' + r.status + ')');
    }

    const blob = await r.blob();
    await loadBeat(blob, b.name);

  } catch (e) {
    status(
      '비트 불러오기 실패: ' + e.message
      + ' · 파일을 직접 선택해 테스트할 수 있습니다.'
    );
  }
};

// ============================================
// 녹음 카운트다운
// ============================================

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function runCountdown() {
  const overlay = $('countdownOverlay');
  const number = $('countdownNumber');

  // HTML에 카운트다운 요소가 없으면 상태창으로 표시
  if (!overlay || !number) {
    for (const text of ['3', '2', '1']) {
      status('녹음 준비 중... ' + text);
      await wait(1000);
    }
    status('GO!');
    return;
  }

  overlay.hidden = false;

  for (const text of ['3', '2', '1']) {
    number.textContent = text;
    status('녹음 준비 중... ' + text);
    await wait(1000);
  }

  number.textContent = 'GO!';

  setTimeout(() => {
    overlay.hidden = true;
  }, 450);
}

// ============================================
// 구간별 녹음
// ============================================

$('record').onclick = async () => {
  if (!beatBuffer) {
    return status('비트를 먼저 선택하세요.');
  }

  if (recording || countdownActive) return;

  countdownActive = true;

  $('record').disabled = true;
  $('play').disabled = true;
  $('reset').disabled = true;

  try {
    const c = audio();
    await c.resume();

    // 카운트다운 전에 마이크 권한 확보
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });

    const mime = [
      'audio/webm;codecs=opus',
      'audio/mp4',
      'audio/webm'
    ].find(t => MediaRecorder.isTypeSupported(t));

    recorder = new MediaRecorder(
      stream,
      mime ? { mimeType: mime } : undefined
    );

    recordChunks = [];

    recorder.ondataavailable = e => {
      if (e.data.size) {
        recordChunks.push(e.data);
      }
    };

    recorder.onstop = async () => {
      try {
        const blob = new Blob(recordChunks, {
          type: recorder.mimeType
        });

        const decoded = await c.decodeAudioData(
          await blob.arrayBuffer()
        );

        tracks.push({
          buffer: decoded,
          start: recordStart,
          enabled: true,
          name: '보컬 ' + (tracks.length + 1)
        });

        renderTracks();
        status('녹음 구간을 추가했어요.');

      } catch (e) {
        status(
          '이 기기의 녹음 형식을 읽지 못했어요: ' + e.message
        );

      } finally {
        stream?.getTracks().forEach(t => t.stop());
        stream = null;

        $('record').disabled = false;
        $('stop').disabled = true;
        $('play').disabled = false;
        $('reset').disabled = false;

        recording = false;
      }
    };

    // 재생 중이면 현재 위치에서 일시정지
    if (playing) {
      pauseBeat();
    }

    // 3, 2, 1 카운트다운
    await runCountdown();

    // 녹음과 비트를 같은 구간에서 시작
    recordStart = position();

    recorder.start(250);
    recording = true;

    startBeat(recordStart);

    $('stop').disabled = false;

    status('● 녹음 중... 원하는 곳에서 종료하세요.');

  } catch (e) {
    stream?.getTracks().forEach(t => t.stop());
    stream = null;

    const overlay = $('countdownOverlay');
    if (overlay) overlay.hidden = true;

    $('record').disabled = false;
    $('play').disabled = false;
    $('reset').disabled = false;

    status(
      '마이크 사용 실패: ' + e.message
      + ' (HTTPS 또는 localhost 필요)'
    );

  } finally {
    countdownActive = false;
  }
};

$('stop').onclick = () => {
  if (recorder?.state === 'recording') {
    recorder.stop();
    pauseBeat();

    $('stop').disabled = true;
    status('녹음 처리 중...');
  }
};

// ============================================
// 녹음 트랙 관리
// ============================================

function renderTracks() {
  const root = $('tracks');
  root.replaceChildren();

  $('count').textContent = tracks.length;

  if (!tracks.length) {
    root.textContent = '녹음한 구간이 여기에 쌓입니다.';
    return;
  }

  tracks.forEach((t, i) => {
    const box = document.createElement('div');
    box.className = 'track';

    const row = document.createElement('div');
    row.className = 'row';

    const name = document.createElement('strong');

    name.textContent =
      t.name + ' · ' + fmt(t.start)
      + ' 시작 · ' + fmt(t.buffer.duration) + ' 길이';

    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = '삭제';

    del.onclick = () => {
      tracks.splice(i, 1);
      renderTracks();
    };

    const chk = document.createElement('label');
    const input = document.createElement('input');

    input.type = 'checkbox';
    input.checked = t.enabled;

    input.onchange = () => {
      t.enabled = input.checked;
    };

    chk.append(input, '사용');
    row.append(name, chk, del);

    const shift = document.createElement('label');
    shift.textContent = '시작 위치(초) ';

    const number = document.createElement('input');

    number.type = 'number';
    number.min = '0';
    number.step = '.05';
    number.value = t.start.toFixed(2);
    number.style.width = '100px';

    number.onchange = () => {
      t.start = Math.max(
        0,
        Math.min(
          beatBuffer.duration,
          Number(number.value) || 0
        )
      );

      renderTracks();
    };

    shift.append(number);
    box.append(row, shift);
    root.append(box);
  });
}

// ============================================
// 믹싱 슬라이더
// ============================================

for (const [id, label] of [
  ['beatGain', 'bgv'],
  ['vocalGain', 'vgv'],
  ['reverb', 'rv']
]) {
  $(id).oninput = e => {
    $(label).textContent = e.target.value + '%';
  };
}

// 자동 믹싱 프리셋
$('auto').onclick = () => {
  $('beatGain').value = 70;
  $('vocalGain').value = 120;
  $('reverb').value = 12;

  for (const [id, label] of [
    ['beatGain', 'bgv'],
    ['vocalGain', 'vgv'],
    ['reverb', 'rv']
  ]) {
    $(id).dispatchEvent(new Event('input'));
  }

  status('기본 랩 믹싱 프리셋을 적용했어요.');
};

// ============================================
// 믹싱 오디오 그래프
// ============================================

function mixGraph(c) {
  const master = c.createGain();
  master.gain.value = .85;

  const compressor = c.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 12;
  compressor.ratio.value = 3;
  compressor.attack.value = .005;
  compressor.release.value = .18;

  compressor.connect(master);
  master.connect(c.destination);

  const beatGain = c.createGain();
  beatGain.gain.value = Number($('beatGain').value) / 100;
  beatGain.connect(master);

  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 95;

  const presence = c.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = 2800;
  presence.Q.value = .8;
  presence.gain.value = 2.5;

  const vg = c.createGain();
  vg.gain.value = Number($('vocalGain').value) / 100;

  hp.connect(presence).connect(vg).connect(compressor);

  const delay = c.createDelay(1);
  delay.delayTime.value = .12;

  const feedback = c.createGain();
  feedback.gain.value = .18;

  delay.connect(feedback).connect(delay);

  const wet = c.createGain();
  wet.gain.value = Number($('reverb').value) / 100 * .4;

  vg.connect(delay);
  delay.connect(wet).connect(master);

  return { beatGain, hp };
}

// ============================================
// 오프라인 믹싱
// ============================================

async function renderMix() {
  if (!beatBuffer) {
    throw Error('비트를 먼저 선택하세요.');
  }

  const rate = 44100;
  const length = Math.ceil(beatBuffer.duration * rate);

  const offline = new OfflineAudioContext(
    2,
    length,
    rate
  );

  const graph = mixGraph(offline);

  function source(buf, dest, start) {
    const s = offline.createBufferSource();
    s.buffer = buf;
    s.connect(dest);
    s.start(Math.max(0, start));
  }

  source(beatBuffer, graph.beatGain, 0);

  for (const t of tracks) {
    if (t.enabled && t.start < beatBuffer.duration) {
      source(t.buffer, graph.hp, t.start);
    }
  }

  return await offline.startRendering();
}

// ============================================
// WAV 파일 생성
// ============================================

function wav(buffer) {
  const channels = 2;
  const n = buffer.length;

  const ab = new ArrayBuffer(
    44 + n * channels * 2
  );

  const v = new DataView(ab);

  const str = (o, s) => {
    for (let i = 0; i < s.length; i++) {
      v.setUint8(o + i, s.charCodeAt(i));
    }
  };

  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 4, true);

  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, buffer.sampleRate, true);
  v.setUint32(28, buffer.sampleRate * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);

  str(36, 'data');
  v.setUint32(40, n * 4, true);

  const a = buffer.getChannelData(0);
  const b = buffer.getChannelData(1);

  for (let i = 0; i < n; i++) {
    for (let ch = 0; ch < 2; ch++) {
      const x = Math.max(
        -1,
        Math.min(1, (ch ? b : a)[i])
      );

      v.setInt16(
        44 + (i * 2 + ch) * 2,
        x < 0 ? x * 32768 : x * 32767,
        true
      );
    }
  }

  return new Blob([ab], {
    type: 'audio/wav'
  });
}

// ============================================
// 미리듣기 및 다운로드
// ============================================

let resultUrl = null;

async function build() {
  status('믹싱 중... 잠시 기다려 주세요.');

  const blob = wav(await renderMix());

  if (resultUrl) {
    URL.revokeObjectURL(resultUrl);
  }

  resultUrl = URL.createObjectURL(blob);
  $('result').src = resultUrl;

  status('믹싱 완료! 들어보거나 다운로드하세요.');

  return resultUrl;
}

$('preview').onclick = async () => {
  try {
    await build();
    $('result').play();
  } catch (e) {
    status('믹싱 실패: ' + e.message);
  }
};

$('export').onclick = async () => {
  try {
    const url = await build();
    const a = document.createElement('a');

    a.href = url;

    a.download =
      'GILRO_STUDIO_'
      + (beatLabel.replace(/\.[^.]+$/, '') || 'mix')
      + '.wav';

    a.click();

  } catch (e) {
    status('내보내기 실패: ' + e.message);
  }
};

// 시작 시 비트 목록 불러오기
loadCatalog();
