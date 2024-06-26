import { sha256 } from 'js-sha256';
import { Hex, IndexerCell, RgbppCkbVirtualTx } from '../types';
import { append0x, remove0x, reverseHex, u32ToLe, utf8ToHex } from './hex';
import {
  BTC_JUMP_CONFIRMATION_BLOCKS,
  RGBPP_TX_ID_PLACEHOLDER,
  getBtcTimeLockScript,
  getRgbppLockScript,
} from '../constants';
import {
  bytesToHex,
  hexToBytes,
  serializeOutPoint,
  serializeOutput,
  serializeScript,
} from '@nervosnetwork/ckb-sdk-utils';
import { BTCTimeLock } from '../schemas/generated/rgbpp';
import { Script } from '../schemas/generated/blockchain';
import { blockchain } from '@ckb-lumos/base';
import { bytes } from '@ckb-lumos/codec';

export const genRgbppLockScript = (rgbppLockArgs: Hex, isMainnet: boolean) => {
  return {
    ...getRgbppLockScript(isMainnet),
    args: append0x(rgbppLockArgs),
  } as CKBComponents.Script;
};

export const genBtcTimeLockArgs = (lock: CKBComponents.Script, btcTxId: Hex, after: number): Hex => {
  const btcTxid = blockchain.Byte32.pack(reverseHex(btcTxId));
  const lockScript = Script.unpack(serializeScript(lock));
  return bytesToHex(BTCTimeLock.pack({ lockScript, after, btcTxid }));
};

/**
 * table BTCTimeLock {
    lock_script: Script,
    after: Uint32,
    btc_txid: Byte32,
  }
 */
export const genBtcTimeLockScript = (toLock: CKBComponents.Script, isMainnet: boolean) => {
  const args = genBtcTimeLockArgs(toLock, RGBPP_TX_ID_PLACEHOLDER, BTC_JUMP_CONFIRMATION_BLOCKS);
  return {
    ...getBtcTimeLockScript(isMainnet),
    args,
  } as CKBComponents.Script;
};

// refer to https://github.com/ckb-cell/rgbpp/blob/0c090b039e8d026aad4336395b908af283a70ebf/contracts/rgbpp-lock/src/main.rs#L173-L211
export const calculateCommitment = (rgbppVirtualTx: RgbppCkbVirtualTx | CKBComponents.RawTransaction): Hex => {
  var hash = sha256.create();
  hash.update(hexToBytes(utf8ToHex('RGB++')));
  const version = [0, 0];
  hash.update(version);
  hash.update([rgbppVirtualTx.inputs.length, rgbppVirtualTx.outputs.length]);

  for (const input of rgbppVirtualTx.inputs) {
    hash.update(hexToBytes(serializeOutPoint(input.previousOutput)));
  }
  for (let index = 0; index < rgbppVirtualTx.outputs.length; index++) {
    const output = rgbppVirtualTx.outputs[index];
    const outputData = rgbppVirtualTx.outputsData[index];
    hash.update(hexToBytes(serializeOutput(output)));
    hash.update(hexToBytes(outputData));
  }
  // double sha256
  return sha256(hash.array());
};

/**
 * table BTCTimeLock {
    lock_script: Script,
    after: Uint32,
    btc_txid: Byte32,
  }
 */
export const lockScriptFromBtcTimeLockArgs = (args: Hex): CKBComponents.Script => {
  const { lockScript } = BTCTimeLock.unpack(append0x(args));
  return {
    ...lockScript,
    args: bytes.hexify(blockchain.Bytes.unpack(lockScript.args)),
  };
};

export const btcTxIdFromBtcTimeLockArgs = (args: Hex): Hex => {
  const btcTimeLockArgs = BTCTimeLock.unpack(append0x(args));
  return reverseHex(append0x(btcTimeLockArgs.btcTxid));
};

export const isRgbppLockOrBtcTimeLock = (lock: CKBComponents.Script, isMainnet: boolean) => {
  const rgbppLock = getRgbppLockScript(isMainnet);
  const isRgbppLock = lock.codeHash === rgbppLock.codeHash && lock.hashType === rgbppLock.hashType;

  const btcTimeLock = getBtcTimeLockScript(isMainnet);
  const isBtcTimeLock = lock.codeHash === btcTimeLock.codeHash && lock.hashType === btcTimeLock.hashType;

  return isRgbppLock || isBtcTimeLock;
};

/**
 * https://learnmeabitcoin.com/technical/general/byte-order/
 * Whenever you're working with transaction/block hashes internally (e.g. inside raw bitcoin data), you use the natural byte order.
 * Whenever you're displaying or searching for transaction/block hashes, you use the reverse byte order.
 */
export const buildRgbppLockArgs = (outIndex: number, btcTxId: Hex): Hex => {
  return `0x${u32ToLe(outIndex)}${remove0x(reverseHex(btcTxId))}`;
};

export const buildPreLockArgs = (outIndex: number) => {
  return buildRgbppLockArgs(outIndex, RGBPP_TX_ID_PLACEHOLDER);
};

export const compareInputs = (a: IndexerCell, b: IndexerCell) => {
  if (a.output.lock.args < b.output.lock.args) {
    return -1;
  }
  if (a.output.lock.args > b.output.lock.args) {
    return 1;
  }
  return 0;
};

/**
 * RGBPP lock args: out_index | bitcoin_tx_id
 * BTC time lock args: lock_script | after | bitcoin_tx_id
 *
 * https://learnmeabitcoin.com/technical/general/byte-order/
 * Whenever you're working with transaction/block hashes internally (e.g. inside raw bitcoin data), you use the natural byte order.
 * Whenever you're displaying or searching for transaction/block hashes, you use the reverse byte order.
 */
const RGBPP_MIN_LOCK_ARGS_SIZE = 36 * 2;
const BTC_TX_ID_SIZE = 32 * 2;
export const replaceLockArgsWithRealBtcTxId = (lockArgs: Hex, txId: Hex): Hex => {
  const argsLength = remove0x(lockArgs).length;
  if (argsLength < RGBPP_MIN_LOCK_ARGS_SIZE) {
    throw new Error('Rgbpp lock args or BTC time lock args length is invalid');
  }
  return `0x${remove0x(lockArgs).substring(0, argsLength - BTC_TX_ID_SIZE)}${remove0x(reverseHex(txId))}`;
};

export const isRgbppLockCell = (cell: CKBComponents.CellOutput, isMainnet: boolean): boolean => {
  const rgbppLock = getRgbppLockScript(isMainnet);
  const isRgbppLock = cell.lock.codeHash === rgbppLock.codeHash && cell.lock.hashType === rgbppLock.hashType;
  return isRgbppLock;
};

export const isBtcTimeLockCell = (cell: CKBComponents.CellOutput, isMainnet: boolean): boolean => {
  const btcTimeLock = getBtcTimeLockScript(isMainnet);
  const isBtcTimeLock = cell.lock.codeHash === btcTimeLock.codeHash && cell.lock.hashType === btcTimeLock.hashType;
  return isBtcTimeLock;
};
