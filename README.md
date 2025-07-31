# Stable Name Service (SNS)

A simplified, permanent naming service for `.stable` domains based on ENS contracts.

**📋 For original ENS documentation, see [docs.ens.domains](https://docs.ens.domains/) and the [original ENS README](https://github.com/ensdomains/ens-contracts/blob/v1.5.2/README.md).**

## 🌟 Key Features

- **🆓 Free Registration**: No payment required, automatic ETH refund if sent
- **♾️ Permanent Ownership**: No expiration dates, no renewal needed
- **🚫 Non-transferable**: All transfer functions blocked to prevent speculation
- **1️⃣ One Domain Per Wallet**: Prevents domain hoarding
- **🔤 Case-insensitive**: Names converted to lowercase for consistency  
- **✅ Comprehensive Validation**: 5-15 character length, no spaces, restricted names
- **🌌 Cosmos-focused**: Optimized for coinType 118 (Cosmos blockchain)

## 🚀 Quick Start

### Installation

```bash
git clone https://github.com/your-org/ens-contracts
cd ens-contracts
bun install
```

### Compile Contracts

```bash
bun run compile
```

### Deploy and Test Locally

```bash
# Deploy and run comprehensive tests on local Hardhat network
bun run hardhat run scripts/deploy-and-test-stable-ens.ts
```

### Deploy and Test on Stable Testnet

**⚠️ Requirements:**
- **3 Private Keys**: You need 3 private keys with ausdt and astable tokens for testing
- **Node.js**: Requires specific Node options for TypeScript transpilation

```bash
# STEP 1: Set environment variables for testnet accounts (REQUIRED!)
export STABLE_TESTNET_PK1="0x1234...your_first_private_key"
export STABLE_TESTNET_PK2="0x5678...your_second_private_key" 
export STABLE_TESTNET_PK3="0x9abc...your_third_private_key"

# STEP 2: Deploy to Stable Testnet with required Node options
NODE_OPTIONS='--experimental-loader ts-node/esm/transpile-only' \
npx hardhat run scripts/deploy-and-test-stable-ens-testnet.ts --network stable_testnet
```

**Stable Testnet Configuration:**
- **Chain ID**: 2201
- **RPC URL**: https://stable-jsonrpc.testnet.chain0.dev
- **Explorer**: https://stable-explorer.testnet.chain0.dev
- **Native Token**: ausdt (name: usdt)
- **Gas Token**: ausdt
- **Required Tokens**: Each test account needs ausdt (for gas) and astable tokens

**Test Accounts Setup:**
- `STABLE_TESTNET_PK1`: Deployer account (needs most ausdt for gas)
- `STABLE_TESTNET_PK2`: User1 for domain registration test (jeongjoo.stable)
- `STABLE_TESTNET_PK3`: User2 for domain registration test (soojong.stable)

### Run Tests

```bash
# Run all tests
bun run test

# Run specific test
bun run test test/ethregistrar/TestETHRegistrarController.js

# Run tests in parallel
bun run test:parallel
```

### Format Code

```bash
bun run format
```

## 📖 How It Works

### Register a .stable Domain

```typescript
// Example registration (completely free)
await controller.register(
  "myname",           // name (5-15 chars, will be converted to lowercase)
  ownerAddress,       // owner address
  0n,                 // duration (ignored - domains are permanent)
  "0x00...",         // secret (ignored - no commit-reveal needed)
  resolverAddress,    // resolver contract address
  [],                 // additional data (optional)
  true,              // set reverse record
  0n                 // owner controlled fuses (ignored)
);
```

### Name Requirements

- **Length**: 5-15 characters only
- **Case**: Case-insensitive (converted to lowercase)
- **Characters**: Unicode supported, but no spaces allowed
- **Restrictions**: 20+ restricted names to prevent impersonation
- **Limit**: One domain per wallet address

### Restricted Names

The following names are pre-restricted to prevent scams:
```
stable, admin, root, system, owner, binance, tether, usdt, usdc, 
ethereum, bitcoin, cosmos, official, support, help, service, 
team, foundation, protocol, network
```

## 🏗️ Architecture

### Contract Changes from Standard ENS

#### BaseRegistrarImplementation.sol
- ❌ **Removed**: Expiry system (`expiries` mapping)
- ❌ **Removed**: Grace period logic
- ✅ **Added**: Transfer blocking (all `transferFrom` functions revert)
- 🔄 **Modified**: `nameExpires()` always returns 0 
- 🔄 **Modified**: `available()` checks if never minted

#### ETHRegistrarController.sol (Complete Rewrite)
- ❌ **Removed**: Commit-reveal mechanism  
- ❌ **Removed**: Price oracle integration
- ❌ **Removed**: NameWrapper integration
- ✅ **Added**: One domain per wallet tracking
- ✅ **Added**: Restricted names system
- ✅ **Added**: Comprehensive name validation
- ✅ **Added**: Case-insensitive processing
- ✅ **Added**: ETH refund functionality
- 🔄 **Modified**: Uses `.stable` TLD instead of `.eth`

#### Root.sol
- ✅ **Added**: Auto-controller setup in constructor

### Deployment & Set the config Flow
1. Deploy ENSRegistry Contract & Root Contract
2. Set Root as root node owner
3. Deploy BaseRegistrarImplementation
4. Set Registrar as .stable owner
5. Deploy ReverseRegistrar
6. Setup reverse resolution
7. Deploy ETHRegistrarController
8. Deploy PublicResolver
9. Add controllers and permissions
10. Ready for registrations

## 🧪 Testing

The deployment script includes comprehensive tests:

- ✅ **Domain Registration**: Free registration with resolver setting
- ✅ **Name Validation**: Length, character, and restriction checks
- ✅ **One Domain Per Wallet**: Prevents multiple registrations
- ✅ **Transfer Prevention**: All transfers blocked
- ✅ **Forward Resolution**: Name → Address lookup
- ✅ **Reverse Resolution**: Address → Name lookup  
- ✅ **ETH Refund**: Automatic refund of accidentally sent ETH
- ✅ **Permanent Ownership**: No expiration or renewal

### Test Output Example

```
Deploying and Testing Stable Name Service

Deployer: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
User1 (jeongjoo): 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
User2 (soojong): 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC

=== Testing Domain Registration: jeongjoo.stable ===
jeongjoo.stable available: true
jeongjoo is valid: true
Controller is authorized: true
✓ Domain registered successfully
✓ Forward resolution working
✓ Reverse resolution working
✓ Transfer prevention working
✓ Free pricing confirmed
✓ Name validation working
✓ One domain per wallet enforced
```

## 🔄 Differences from Standard ENS

| Feature | Standard ENS | Stable Name Service |
|---------|-------------|-------------------|
| **Cost** | Variable ETH pricing | Completely free |
| **Ownership** | Temporary (renewable) | Permanent |
| **Transfers** | Full NFT trading | Blocked |
| **Registration** | Commit-reveal (60s delay) | Instant |
| **Name Length** | 3+ characters | 5-15 characters |
| **Case Handling** | Case-sensitive | Case-insensitive |
| **Wallet Limit** | Unlimited | 1 domain per wallet |
| **Restricted Names** | None built-in | 20+ restricted |
| **TLD** | `.eth` | `.stable` |

## 🔧 Development

### Project Structure

```
contracts/
├── registry/           # Core ENS registry contracts
├── ethregistrar/      # Modified registrar contracts
├── resolvers/         # Standard resolver contracts  
├── root/             # Root contract with optimizations
└── utils/            # Utility contracts

scripts/
└── deploy-and-test-stable-ens.ts  # Complete deployment & test script
```

### Commands

```bash
# Development
bun install              # Install dependencies
bun run compile          # Compile contracts
bun run test            # Run tests
bun run format          # Format code
bun run lint            # Run contract linting

# Deployment
bun run hardhat run scripts/deploy-and-test-stable-ens.ts --network localhost
```

## 🎯 Use Cases

- **Cosmos Ecosystem Identity**: Primary names for Cosmos addresses
- **Community Governance**: Non-transferable identity for DAOs
- **Developer Tooling**: Permanent names for smart contract addresses
- **Social Identity**: Web3 social profiles without speculation

## ⚠️ Important Notes

- **Non-transferable**: Once registered, domains cannot be transferred or sold
- **Permanent**: No expiration dates or renewal process
- **One per wallet**: Each address can only register one domain
- **Case-insensitive**: All names stored and resolved in lowercase
- **Free forever**: No costs involved in registration or maintenance

## 🤝 Contributing

This project maintains the original ENS development workflow. See the [original ENS README](https://github.com/ensdomains/ens-contracts/blob/v1.5.2/README.md) for detailed contribution guidelines.

## 📄 License

Same as original ENS contracts. See LICENSE file for details.

---

**🔗 Links:**
- [Original ENS Documentation](https://docs.ens.domains/)
- [Original ENS Contracts](https://github.com/ensdomains/ens-contracts)
- [ENS v1.5.2 Reference](https://github.com/ensdomains/ens-contracts/tree/v1.5.2)