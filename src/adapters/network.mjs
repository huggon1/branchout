import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
// Desktop workers receive resolved proxy settings from Electron, never from source content.
export function configureNetwork() {
  setGlobalDispatcher(new EnvHttpProxyAgent());
}
