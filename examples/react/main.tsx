// React: <ZenLipSync> loads the avatar; onReady hands over the AvatarHandle.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ZenLipSync, type AvatarHandle } from '@zenryokukikai/zen-lipsync/react';

const assetsBaseUrl = new URL('../../', location.href).href;

async function sample(): Promise<{ pcm: Float32Array; sampleRate: number }> {
  const buf = await (await fetch(new URL('avatars/marine/normal/sample.wav', assetsBaseUrl))).arrayBuffer();
  const ab = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(buf);
  return { pcm: ab.getChannelData(0), sampleRate: ab.sampleRate };
}

function App() {
  const [avatar, setAvatar] = useState<AvatarHandle | null>(null);
  const [message, setMessage] = useState('読み込んでいます…');
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 720, margin: '0 auto', padding: 16 }}>
      <h1>ZEN-LipSync：React の例</h1>
      <ZenLipSync
        assetsBaseUrl={assetsBaseUrl}
        avatar="avatars/marine/avatar.json"
        onReady={(a) => { setAvatar(a); setMessage('準備ができました'); }}
        onError={(e) => setMessage(e.name === 'WebGPUUnavailableError' ? 'WebGPU が使えません' : e.message)}
      />
      <p>
        <button disabled={!avatar} onClick={async () => { await avatar!.speak(await sample()); setMessage('話し終わりました'); }}>話させる</button>{' '}
        <button disabled={!avatar} onClick={() => void avatar!.setIdle(avatar!.idle === 'normal' ? 'angry' : 'normal')}>待機映像を切り替える</button>{' '}
        <span id="out">{message}</span>
      </p>
      <p>リップシンク：ZEN-LipSync（<a href="https://zenryokukikai.com">https://zenryokukikai.com</a>）</p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
