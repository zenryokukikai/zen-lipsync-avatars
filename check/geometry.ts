// For scripts/check-geometry.mjs: one avatar in #box with no avatar CSS from the page. ?fit=contain|cover sets the SDK
// option; ?h=<css length> gives the container a fixed height (as a page's own CSS might).
import { create, type AvatarHandle, type AvatarFit } from '@zenryokukikai/zen-lipsync';

const q = new URLSearchParams(location.search);
const box = document.getElementById('box')!;
const h = q.get('h');
if (h) box.style.height = h;
const fit = q.get('fit') as AvatarFit | null;
const state: { ready: boolean; error: string | null; avatar: AvatarHandle | null } = { ready: false, error: null, avatar: null };
(window as unknown as { geo: typeof state }).geo = state;
create({ container: box, assetsBaseUrl: new URL('../', location.href).href, avatar: 'avatars/marine/avatar.json', ...(fit ? { fit } : {}) })
  .then((a) => { state.avatar = a; state.ready = true; }, (e: unknown) => { state.error = String(e); });
