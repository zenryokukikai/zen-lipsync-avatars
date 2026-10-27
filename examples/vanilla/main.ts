// The smallest use of the SDK in a page: load the avatar, speak a WAV, switch the idle loop.
import { create, WebGPUUnavailableError } from '@zenryokukikai/zen-lipsync';

// Where the zen-lipsync-avatars files are served (this repository's root, here two levels up).
const assetsBaseUrl = new URL('../../', location.href).href;

const out = document.getElementById('out')!;
document.getElementById('start')!.addEventListener('click', async () => {
  try {
    const avatar = await create({ container: document.getElementById('avatar')!, assetsBaseUrl, avatar: 'avatars/marine/avatar.json' });
    avatar.on('speechend', ({ interrupted }) => { out.textContent = interrupted ? '止めました' : '話し終わりました'; });

    // a WAV file → mono Float32Array at its own sample rate
    const buf = await (await fetch(new URL('avatars/marine/normal/sample.wav', assetsBaseUrl))).arrayBuffer();
    const ab = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(buf);
    await avatar.speak({ pcm: ab.getChannelData(0), sampleRate: ab.sampleRate });

    await avatar.setIdle('angry');
  } catch (e) {
    out.textContent = e instanceof WebGPUUnavailableError ? 'WebGPU が使えません' : String(e);
  }
});
