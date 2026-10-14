import {
  createPublicClient,
  createWalletClient,
  http,
  type Abi,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getChain, getDeployment } from "@monsoc/sdk";
import { config } from "./config";

export const chain = getChain(config.chainId);
export const deployment = getDeployment(config.chainId);
export const relayAccount = privateKeyToAccount(config.relayKey);

// public RPCs rate-limit (Monad testnet: 25 req/s); back off and retry instead of failing the job
const transport = http(config.rpcUrl, { retryCount: 6, retryDelay: 500 });
export const publicClient = createPublicClient({ chain, transport });
export const walletClient = createWalletClient({ chain, transport, account: relayAccount });

/** Serialize relay-wallet writes so nonces never collide. */
let queue: Promise<unknown> = Promise.resolve();

export function send(args: {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
}): Promise<{ hash: Hex; receipt: TransactionReceipt }> {
  const job = queue.then(async () => {
    const { request } = await publicClient.simulateContract({ ...args, account: relayAccount } as never);
    const hash = await walletClient.writeContract(request as never);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return { hash, receipt };
  });
  queue = job.catch(() => undefined);
  return job;
}

export function sendValue(to: Address, value: bigint) {
  const job = queue.then(async () => {
    const hash = await walletClient.sendTransaction({ to, value });
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  });
  queue = job.catch(() => undefined);
  return job;
}
