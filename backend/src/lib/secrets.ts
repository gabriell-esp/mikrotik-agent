import { config } from '../config.js';
import { SecretBox } from './crypto.js';

let box: SecretBox | null = null;

export function secretBox(): SecretBox {
  if (!box) box = new SecretBox(config.masterKey);
  return box;
}
