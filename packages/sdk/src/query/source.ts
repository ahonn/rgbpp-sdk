import { NetworkType } from '../network';
import { UnspentOutput } from '../types';
import { ErrorCodes, TxBuildError } from '../error';
import { addressToScriptPublicKeyHex, getAddressType } from '../address';
import { BtcAssetsApi } from './service';

export class DataSource {
  public source: BtcAssetsApi;
  public networkType: NetworkType;

  constructor(source: BtcAssetsApi, networkType: NetworkType) {
    this.source = source;
    this.networkType = networkType;
  }

  async getUtxos(address: string): Promise<UnspentOutput[]> {
    const utxos = await this.source.getUtxos(address);

    const scriptPk = addressToScriptPublicKeyHex(address, this.networkType);
    return utxos
      .sort((a, b) => {
        const aOrder = `${a.status.block_height}${a.vout}`;
        const bOrder = `${b.status.block_height}${b.vout}`;
        return Number(aOrder) - Number(bOrder);
      })
      .map((row): UnspentOutput => {
        return {
          address,
          scriptPk,
          txid: row.txid,
          vout: row.vout,
          value: row.value,
          addressType: getAddressType(address),
        };
      });
  }

  async collectSatoshi(
    address: string,
    targetAmount: number,
    minimalSatoshi?: number,
  ): Promise<{
    utxos: UnspentOutput[];
    satoshi: number;
    exceedSatoshi: number;
  }> {
    const utxos = await this.getUtxos(address);

    const collected = [];
    let collectedAmount = 0;
    for (const utxo of utxos) {
      if (collectedAmount >= targetAmount) {
        break;
      }
      if (minimalSatoshi !== void 0 && utxo.value < minimalSatoshi) {
        continue;
      }
      collected.push(utxo);
      collectedAmount += utxo.value;
    }

    if (collectedAmount < targetAmount) {
      throw new TxBuildError(ErrorCodes.INSUFFICIENT_UTXO);
    }

    return {
      utxos: collected,
      satoshi: collectedAmount,
      exceedSatoshi: collectedAmount - targetAmount,
    };
  }
}
