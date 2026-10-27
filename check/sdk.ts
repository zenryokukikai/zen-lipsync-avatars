// For scripts/check.mjs: the SDK on window.ZenLipSync (create / destroy cycles, the WebGPUUnavailableError check).
import * as ZenLipSync from '@zenryokukikai/zen-lipsync';

(window as unknown as { ZenLipSync: typeof ZenLipSync }).ZenLipSync = ZenLipSync;
