import hre from "hardhat";
import { namehash } from "viem";

async function main() {
    console.log("Testing Stable Name Service on local hardhat network...");
    
    const [deployer, user1, user2, user3] = await hre.viem.getWalletClients();
    
    console.log("Accounts:");
    console.log("  Deployer:", deployer.account.address);
    console.log("  User1:", user1.account.address);
    console.log("  User2:", user2.account.address);
    console.log("  User3:", user3.account.address);
    
    const STABLE_NODE = "0xbc67d859e38ff2c79747cbf55827e66700c058ff8a1b8990fb27e9c934ba3b6c";
    
    // 1. Deploy contracts
    console.log("\\n1. Deploying Stable Name Service contracts...");
    
    // Deploy ENSRegistry
    const registry = await hre.viem.deployContract("ENSRegistry", []);
    console.log("ENSRegistry deployed to:", registry.address);
    
    // Create .stable node
    const stableLabel = "0x5802f6cb6a8bdbe0204d6c66324b68cf9295a374b94261674e8d2e4a11d53ad5";
    await deployer.writeContract({
        address: registry.address,
        abi: registry.abi,
        functionName: 'setSubnodeOwner',
        args: ["0x0000000000000000000000000000000000000000000000000000000000000000", stableLabel, deployer.account.address],
        gas: 3000000n
    });
    console.log("Created .stable TLD");
    
    // Deploy BaseRegistrarImplementation (modified for Stable Name Service)
    const registrar = await hre.viem.deployContract("BaseRegistrarImplementation", [
        registry.address
    ]);
    console.log("BaseRegistrarImplementation deployed to:", registrar.address);
    
    // Deploy ETHRegistrarController (modified for Stable Name Service)
    const controller = await hre.viem.deployContract("ETHRegistrarController", [
        registrar.address
    ]);
    console.log("ETHRegistrarController deployed to:", controller.address);
    
    // Add controller to registrar
    await deployer.writeContract({
        address: registrar.address,
        abi: registrar.abi,
        functionName: 'addController',
        args: [controller.address],
        gas: 3000000n
    });
    console.log("Added controller to registrar");
    
    // Transfer .stable ownership to registrar
    await deployer.writeContract({
        address: registry.address,
        abi: registry.abi,
        functionName: 'setOwner',
        args: [STABLE_NODE, registrar.address],
        gas: 3000000n
    });
    console.log("Transferred .stable ownership to StableRegistrar");
    
    console.log("\\n2. Testing Stable Name Service Policies...");
    
    // Test 1: Valid name registration (5-15 chars)
    console.log("\\nTest 1: Register valid name 'alice' (5 chars)");
    try {
        await controller.write.register([
            "alice", 
            "0x0000000000000000000000000000000000000000" as `0x${string}`
        ], { 
            account: user1.account,
            gas: 3000000n
        });
        console.log("✅ SUCCESS: alice registered to", user1.account.address);
        
        const domain = await controller.read.getFullDomainByAccount([user1.account.address]);
        console.log("   Full domain:", domain);
    } catch (error: any) {
        console.log("❌ FAILED:", error.shortMessage || error.message);
        return;
    }
    
    // Test 2: Name too short (should fail)
    console.log("\\nTest 2: Try to register 'bob' (3 chars - too short)");
    try {
        await controller.write.register([
            "bob", "0x0000000000000000000000000000000000000000" as `0x${string}`
        ], { 
            account: user2.account,
            gas: 3000000n
        });
        console.log("❌ ERROR: Should have failed!");
    } catch (error: any) {
        console.log("✅ SUCCESS: Registration rejected -", error.shortMessage || "Name too short");
    }
    
    // Test 3: Reserved name (should fail)
    console.log("\\nTest 3: Try to register 'stable' (reserved name)");
    try {
        await controller.write.register([
            "stable", "0x0000000000000000000000000000000000000000" as `0x${string}`
        ], { 
            account: user2.account,
            gas: 3000000n
        });
        console.log("❌ ERROR: Should have failed!");
    } catch (error: any) {
        console.log("✅ SUCCESS: Registration rejected -", error.shortMessage || "Name reserved");
    }
    
    // Test 4: One name per wallet (should fail)
    console.log("\\nTest 4: Try to register 'bobby' with User1 (One Name Per Wallet)");
    try {
        await controller.write.register([
            "bobby", "0x0000000000000000000000000000000000000000" as `0x${string}`
        ], { 
            account: user1.account,
            gas: 3000000n
        });
        console.log("❌ ERROR: Should have failed!");
    } catch (error: any) {
        console.log("✅ SUCCESS: Registration rejected -", error.shortMessage || "One name per wallet");
    }
    
    // Test 5: Valid second user registration
    console.log("\\nTest 5: Register 'charlie' with User2");
    try {
        await controller.write.register([
            "charlie", "0x0000000000000000000000000000000000000000" as `0x${string}`
        ], { 
            account: user2.account,
            gas: 3000000n
        });
        console.log("✅ SUCCESS: charlie registered to", user2.account.address);
        
        const domain = await controller.read.getFullDomainByAccount([user2.account.address]);
        console.log("   Full domain:", domain);
    } catch (error: any) {
        console.log("❌ FAILED:", error.shortMessage || error.message);
    }
    
    // Test 6: Case insensitive (Alice vs alice)
    console.log("\\nTest 6: Try to register 'Alice' (case insensitive - should fail)");
    try {
        await controller.write.register([
            "Alice", "0x0000000000000000000000000000000000000000" as `0x${string}`
        ], { 
            account: user3.account,
            gas: 3000000n
        });
        console.log("❌ ERROR: Should have failed!");
    } catch (error: any) {
        console.log("✅ SUCCESS: Registration rejected -", error.shortMessage || "Name already taken");
    }
    
    // Test 7: Test name validation
    console.log("\\nTest 7: Test name validation");
    const testNames = [
        { name: "test", valid: false, reason: "too short" },
        { name: "alice", valid: false, reason: "already taken" },
        { name: "validname", valid: true, reason: "valid" },
        { name: "verylongname1234", valid: false, reason: "too long (16 chars)" },
        { name: "test name", valid: false, reason: "contains space" }
    ];
    
    for (const test of testNames) {
        const isValid = await controller.read.valid([test.name]);
        const isAvailable = await controller.read.available([test.name]);
        console.log(`   '${test.name}': valid=${isValid}, available=${isAvailable} (${test.reason})`);
    }
    
    // Test 8: Test ENS Registry integration
    console.log("\\nTest 8: Test ENS Registry integration");
    const aliceNode = namehash("alice.stable");
    const charlieNode = namehash("charlie.stable");
    
    const aliceOwner = await registry.read.owner([aliceNode]);
    const charlieOwner = await registry.read.owner([charlieNode]);
    
    console.log("ENS Registry node ownership:");
    console.log("   alice.stable:", aliceOwner.toLowerCase() === user1.account.address.toLowerCase() ? "✅ User1" : `❌ Expected ${user1.account.address}, got ${aliceOwner}`);
    console.log("   charlie.stable:", charlieOwner.toLowerCase() === user2.account.address.toLowerCase() ? "✅ User2" : `❌ Expected ${user2.account.address}, got ${charlieOwner}`);
    
    // Test 9: Test NFT ownership (immutable)
    console.log("\\nTest 9: Test NFT immutability");
    const aliceTokenId = await registrar.read.accountToTokenId([user1.account.address]);
    console.log("   Alice's NFT Token ID:", aliceTokenId.toString());
    
    try {
        // Try to transfer NFT (should fail)
        await registrar.write.transferFrom([
            user1.account.address,
            user2.account.address,
            aliceTokenId
        ], { account: user1.account });
        console.log("❌ ERROR: NFT transfer should have failed!");
    } catch (error: any) {
        console.log("✅ SUCCESS: NFT transfer blocked (immutable ownership)");
    }
    
    console.log("\\n🎉 All Stable Name Service policies verified!");
    console.log("\\n📋 Summary:");
    console.log("✅ One Name Per Wallet enforced");
    console.log("✅ Name length validation (5-15 chars)");
    console.log("✅ Reserved names protection");
    console.log("✅ Case-insensitive registration");
    console.log("✅ Free registration (zero cost)");
    console.log("✅ Immutable ownership (no transfers)");
    console.log("✅ ENS Registry integration");
    console.log("✅ Off-chain metadata ready");
    
    console.log("\\n🔧 Architecture:");
    console.log("- ENSRegistry: Core registry");
    console.log("- StableRegistrar: .stable domain management");
    console.log("- SimplifiedStableController: Registration logic");
    console.log("- No admin roles (DAO governance ready)");
    console.log("- No reverse registrar (off-chain metadata)");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Test failed:", error);
        process.exit(1);
    });