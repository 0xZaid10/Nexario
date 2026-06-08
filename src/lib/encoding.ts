import {
  encodeAbiParameters,
  encodePacked,
  keccak256,
  parseAbiParameters,
  toHex,
  type Address,
  type Hex,
} from 'viem'
import type { Caveat, Delegation } from '../types/index.js'

export function encodeDelegation(delegation: Delegation): Hex {
  return encodeAbiParameters(
    parseAbiParameters(
      '(address delegate, address delegator, bytes32 authority, (address enforcer, bytes terms)[] caveats, uint256 salt, bytes signature)'
    ),
    [
      {
        delegate: delegation.delegate,
        delegator: delegation.delegator,
        authority: delegation.authority,
        caveats: delegation.caveats.map((c) => ({
          enforcer: c.enforcer,
          terms: c.terms,
        })),
        salt: delegation.salt,
        signature: delegation.signature,
      },
    ]
  )
}

export function encodePermissionContext(
  delegationChain: Delegation[]
): Hex {
  return encodeAbiParameters(
    parseAbiParameters(
      '(address delegate, address delegator, bytes32 authority, (address enforcer, bytes terms)[] caveats, uint256 salt, bytes signature)[]'
    ),
    [
      delegationChain.map((d) => ({
        delegate: d.delegate,
        delegator: d.delegator,
        authority: d.authority,
        caveats: d.caveats,
        salt: d.salt,
        signature: d.signature,
      })),
    ]
  )
}

export function encodeExecution(
  target: Address,
  value: bigint,
  callData: Hex
): Hex {
  return encodePacked(
    ['address', 'uint256', 'bytes'],
    [target, value, callData]
  )
}

export function encodeBudgetCaveatTerms(maxAmountUsdc: bigint): Hex {
  return encodeAbiParameters(parseAbiParameters('uint256'), [maxAmountUsdc])
}

export function encodeTimestampCaveatTerms(
  validAfter: number,
  validUntil: number
): Hex {
  return encodeAbiParameters(parseAbiParameters('uint128, uint128'), [
    BigInt(validAfter),
    BigInt(validUntil),
  ])
}

export function encodeActionScopeCaveatTerms(
  allowedActions: string[]
): Hex {
  const packed = allowedActions
    .map((a) => keccak256(toHex(a)))
    .join('')
  return encodeAbiParameters(parseAbiParameters('bytes32[]'), [
    allowedActions.map((a) => keccak256(toHex(a))),
  ])
}

export function encodeUsdcTransfer(to: Address, amount: bigint): Hex {
  return encodeAbiParameters(
    parseAbiParameters('address, uint256'),
    [to, amount]
  ) as Hex
}

export function buildUsdcTransferCalldata(to: Address, amount: bigint): Hex {
  const selector = '0xa9059cbb'
  const params = encodeAbiParameters(
    parseAbiParameters('address, uint256'),
    [to, amount]
  )
  return (selector + params.slice(2)) as Hex
}

export function getDelegationHash(
  delegation: Omit<Delegation, 'signature'>,
  domainSeparator: Hex
): Hex {
  const structHash = keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        'bytes32, address, address, bytes32, bytes32, uint256'
      ),
      [
        keccak256(toHex('Delegation(address delegate,address delegator,bytes32 authority,(address enforcer,bytes terms)[] caveats,uint256 salt)')),
        delegation.delegate,
        delegation.delegator,
        delegation.authority,
        keccak256(encodeAbiParameters(
          parseAbiParameters('(address enforcer, bytes terms)[]'),
          [delegation.caveats]
        )),
        delegation.salt,
      ]
    )
  )

  return keccak256(
    encodePacked(
      ['string', 'bytes32', 'bytes32'],
      ['\x19\x01', domainSeparator, structHash]
    )
  )
}

export function hexToNumber(hex: Hex): number {
  return parseInt(hex, 16)
}

export function numberToHex(n: number | bigint): Hex {
  return `0x${n.toString(16)}` as Hex
}

export function usdcToAtoms(usdcAmount: number): bigint {
  return BigInt(Math.round(usdcAmount * 1_000_000))
}

export function atomsToUsdc(atoms: bigint): number {
  return Number(atoms) / 1_000_000
}
