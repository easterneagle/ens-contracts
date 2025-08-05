# ens-contracts

ENS fork for .stable domains. Started from v1.5.2.

## Changes

- No fees, no expiry
- Can't transfer domains (NFT transfers disabled) 
- 1 domain per address limit
- Names must be 5-15 chars, gets lowercased
- No commit-reveal bullshit, instant registration
- Hardcoded to .stable TLD

## Quick Start

```bash
git clone https://github.com/your-org/ens-contracts
cd ens-contracts
bun install
bun run compile
```

### Local deployment

```bash
NODE_OPTIONS='--experimental-loader ts-node/esm/transpile-only' \
npx hardhat run scripts/deploy-and-test-stable-ens.ts --network localhost
```

### Testnet deployment

Need 3 accounts with ausdt for gas:

```bash
export STABLE_TESTNET_PK1="0x..." # deployer
export STABLE_TESTNET_PK2="0x..." # test user 1
export STABLE_TESTNET_PK3="0x..." # test user 2

NODE_OPTIONS='--experimental-loader ts-node/esm/transpile-only' \
npx hardhat run scripts/deploy-and-test-stable-ens-testnet.ts --network testnet
```

Testnet info:
- Chain ID: 2201
- RPC: https://stable-jsonrpc.testnet.chain0.dev
- Explorer: https://stable-explorer.testnet.chain0.dev
- Gas token: ausdt

## Usage

```typescript
// Register a name
await controller.register(
  "myname",        // 5-15 chars
  ownerAddress,    
  0n,              // duration (ignored)
  "0x00...",      // secret (ignored)
  resolverAddress,
  [],              // data
  true,            // reverse record
  0n               // fuses (ignored)
);
```

### Rules

- 5-15 characters
- No spaces or dots
- Gets lowercased automatically  
- 1 per address
- Can't register: stable, admin, root, system, owner, binance, tether, usdt, usdc, ethereum, bitcoin, cosmos, official, support, help, service, team, foundation, protocol, network

## What changed

**BaseRegistrarImplementation.sol**
- Ripped out expiry system
- Blocked all transfers
- nameExpires() returns 0
- available() just checks _exists()

**ETHRegistrarController.sol** 
- Rewrote from scratch
- No commit-reveal, no pricing
- hasRegisteredName mapping tracks who has domains
- restrictedNames mapping blocks bad names
- Forces lowercase, validates 5-15 chars
- Refunds any ETH sent

**Root.sol**
- Auto-adds deployer as controller

### Deployment order

1. ENSRegistry + Root
2. Root gets root node
3. BaseRegistrarImplementation 
4. Registrar gets .stable
5. ReverseRegistrar
6. Setup .addr.reverse
7. ETHRegistrarController
8. PublicResolver
9. Wire up controllers

## Test output

```
Deploying and Testing Stable Name Service

Deployer: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
User1 (jeongjoo): 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
User2 (soojong): 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC

Testing Domain Registration: jeongjoo.stable
jeongjoo.stable available: true
jeongjoo is valid: true
Controller is authorized: true
Domain registered successfully
Forward resolution working
Reverse resolution working  
Transfer prevention working
Free pricing confirmed
Name validation working
One domain per wallet enforced
```

## ENS vs Stable Name Service

```
ENS: costs ETH, expires, transferable, 2-step registration, 3+ chars, unlimited domains
This: free, permanent, locked, instant, 5-15 chars, 1 per address
```

## Development

```
contracts/
├── registry/          # ENS registry
├── ethregistrar/      # Modified for .stable
├── resolvers/         # Same as ENS
├── root/              # TLD controller
└── utils/

scripts/
├── deploy-and-test-stable-ens.ts
└── deploy-and-test-stable-ens-testnet.ts
```

## Notes

- Can't sell or transfer domains once registered
- No expiry, domains are permanent
- If you send USDT it gets refunded

## Links

- [ENS docs](https://docs.ens.domains/)
- [Original repo](https://github.com/ensdomains/ens-contracts)
- [v1.5.2 tag](https://github.com/ensdomains/ens-contracts/tree/v1.5.2)