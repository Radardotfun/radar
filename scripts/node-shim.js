// What pump's SDK and Solana's web3.js expect from Node, for the launch page's bundle.
import { Buffer } from 'buffer';

export { Buffer };
export const process = { env: {}, browser: true, version: '', versions: {} };
