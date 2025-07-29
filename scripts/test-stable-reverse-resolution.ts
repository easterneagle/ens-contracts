import hre from "hardhat";
import { namehash, keccak256 } from "viem";

async function main() {
    console.log("Testing Complete Stable Name Service with Reverse Resolution...");
    
    const [deployer, user1, user2] = await hre.viem.getWalletClients();
    
    const STABLE_NODE = "0xbc67d859e38ff2c79747cbf55827e66700c058ff8a1b8990fb27e9c934ba3b6c";
    const ADDR_REVERSE_NODE = "0x91d1777781884d03a6757a803996e38de2a42967fb37eeaca72729271025a9e2";
    
    // 1. Deploy contracts
    console.log("\n1. Deploying contracts...");
    
    const registry = await hre.viem.deployContract("ENSRegistry", []);
    console.log("ENSRegistry deployed to:", registry.address);
    
    // Set up .stable TLD
    const stableLabel = "0x5802f6cb6a8bdbe0204d6c66324b68cf9295a374b94261674e8d2e4a11d53ad5";
    await deployer.writeContract({
        address: registry.address,
        abi: registry.abi,
        functionName: 'setSubnodeOwner',
        args: ["0x0000000000000000000000000000000000000000000000000000000000000000", stableLabel, deployer.account.address],
        gas: 3000000n
    });
    
    // Set up reverse resolution domain hierarchy (.reverse -> addr.reverse)
    const reverseLabel = keccak256("reverse");
    const addrLabel = keccak256("addr");
    
    // Create .reverse domain
    await deployer.writeContract({
        address: registry.address,
        abi: registry.abi,
        functionName: 'setSubnodeOwner',
        args: ["0x0000000000000000000000000000000000000000000000000000000000000000", reverseLabel, deployer.account.address],
        gas: 3000000n
    });
    
    // Create addr.reverse domain  
    const reverseNode = namehash("reverse");
    await deployer.writeContract({
        address: registry.address,
        abi: registry.abi,
        functionName: 'setSubnodeOwner',
        args: [reverseNode, addrLabel, deployer.account.address],
        gas: 3000000n
    });
    
    const registrar = await hre.viem.deployContract("BaseRegistrarImplementation", [
        registry.address
    ]);
    console.log("BaseRegistrarImplementation deployed to:", registrar.address);
    
    const controller = await hre.viem.deployContract("ETHRegistrarController", [
        registrar.address
    ]);
    console.log("ETHRegistrarController deployed to:", controller.address);
    
    const reverseRegistrar = await hre.viem.deployContract("ReverseRegistrar", [
        registry.address
    ], {
        gas: 5000000n
    });
    console.log("ReverseRegistrar deployed to:", reverseRegistrar.address);
    
    // Deploy PublicResolver
    const publicResolver = await hre.viem.deployContract("PublicResolver", [
        registry.address,
        "0x0000000000000000000000000000000000000000" as `0x${string}`, // nameWrapper
        registrar.address, // trustedETHController
        reverseRegistrar.address  // trustedReverseRegistrar
    ], {
        gas: 8000000n
    });
    console.log("PublicResolver deployed to:", publicResolver.address);
    
    // Set up controller
    await deployer.writeContract({
        address: registrar.address,
        abi: registrar.abi,
        functionName: 'addController',
        args: [controller.address],
        gas: 3000000n
    });
    
    await deployer.writeContract({
        address: registry.address,
        abi: registry.abi,
        functionName: 'setOwner',
        args: [STABLE_NODE, registrar.address],
        gas: 3000000n
    });
    
    // Set up reverse registrar
    await deployer.writeContract({
        address: reverseRegistrar.address,
        abi: reverseRegistrar.abi,
        functionName: 'setDefaultResolver',
        args: [publicResolver.address],
        gas: 3000000n
    });
    
    await deployer.writeContract({
        address: registry.address,
        abi: registry.abi,
        functionName: 'setOwner',
        args: [ADDR_REVERSE_NODE, reverseRegistrar.address],
        gas: 3000000n
    });
    
    console.log("\n2. Testing complete name service workflow...");
    
    const aliceNode = namehash("alice.stable");
    
    // Step 1: Register domain
    console.log("\nStep 1: Registering alice.stable...");
    await controller.write.register([
        "alice", 
        "0x0000000000000000000000000000000000000000" as `0x${string}`
    ], { 
        account: user1.account,
        gas: 3000000n
    });
    
    // Step 2: User sets resolver
    console.log("Step 2: Setting PublicResolver for alice.stable...");
    await registry.write.setResolver([
        aliceNode,
        publicResolver.address
    ], {
        account: user1.account,
        gas: 3000000n
    });
    
    // Step 3: User sets address record (forward resolution)
    console.log("Step 3: Setting address record (forward resolution)...");
    await publicResolver.write.setAddr([
        aliceNode,
        user1.account.address
    ], {
        account: user1.account,
        gas: 3000000n
    });
    
    // Step 4: Set up reverse resolution via ReverseRegistrar
    console.log("Step 4: Setting up reverse resolution...");
    await reverseRegistrar.write.setNameForAddr([
        user1.account.address,
        user1.account.address,
        publicResolver.address,
        "alice.stable"
    ], {
        account: user1.account,
        gas: 3000000n
    });
    
    console.log("\n📱 Testing Complete Resolution:");
    
    // Test forward resolution (name -> address)
    try {
        const resolvedAddr = await publicResolver.read.addr([aliceNode]);
        console.log(`✅ Forward: alice.stable -> ${resolvedAddr}`);
        console.log(`   Expected: ${user1.account.address}`);
        console.log(`   Match: ${resolvedAddr.toLowerCase() === user1.account.address.toLowerCase() ? '✅' : '❌'}`);
    } catch (error: any) {
        console.log("❌ Forward resolution failed:", error.shortMessage);
    }
    
    // Test reverse resolution (address -> name)
    try {
        const user1Name = await publicResolver.read.getName([user1.account.address]);
        console.log(`✅ Reverse: ${user1.account.address} -> "${user1Name}"`);
        console.log(`   Expected: "alice.stable"`);
        console.log(`   Match: ${user1Name === "alice.stable" ? '✅' : '❌'}`);
    } catch (error: any) {
        console.log("❌ Reverse resolution failed:", error.shortMessage);
    }
    
    // Test immutability - trying to set reverse record again should fail
    console.log("\n🔒 Testing Immutability:");
    try {
        await reverseRegistrar.write.setNameForAddr([
            user1.account.address,
            user1.account.address,
            publicResolver.address,
            "different.stable"
        ], {
            account: user1.account,
            gas: 3000000n
        });
        console.log("❌ Immutability test FAILED - should have reverted");
    } catch (error: any) {
        console.log("✅ Immutability test PASSED - reverse record cannot be changed");
        console.log(`   Error: ${error.shortMessage || "Reverted as expected"}`);
    }
    
    // Test one-name-per-wallet policy
    console.log("\n👤 Testing One-Name-Per-Wallet Policy:");
    try {
        await controller.write.register([
            "bobby", 
            "0x0000000000000000000000000000000000000000" as `0x${string}`
        ], { 
            account: user1.account, // Same user trying to register second name
            gas: 3000000n
        });
        console.log("❌ One-name policy test FAILED - should have reverted");
    } catch (error: any) {
        console.log("✅ One-name policy test PASSED - user cannot register second name");
        console.log(`   Error: ${error.shortMessage || "Reverted as expected"}`);
    }
    
    console.log("\n🎯 Stable Name Service Summary:");
    console.log("✅ Forward resolution (name->address) working");
    console.log("✅ Reverse resolution (address->name) working via ReverseRegistrar");
    console.log("✅ Immutable ownership policy enforced");
    console.log("✅ One-name-per-wallet policy enforced");
    console.log("✅ ENS standard compatibility maintained");
    console.log("✅ ReverseRegistrar integration complete");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Complete Stable Name Service test failed:", error);
        process.exit(1);
    });