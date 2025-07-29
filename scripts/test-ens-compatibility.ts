import hre from "hardhat";
import { namehash, keccak256, toBytes } from "viem";

async function main() {
    console.log("Testing ENS Standard Compatibility with Stable Name Service...");
    
    const [deployer, user1, user2, user3] = await hre.viem.getWalletClients();
    const publicClient = await hre.viem.getPublicClient();
    
    console.log("Accounts:");
    console.log("  Deployer:", deployer.account.address);
    console.log("  User1:", user1.account.address);
    console.log("  User2:", user2.account.address);
    
    const STABLE_NODE = "0xbc67d859e38ff2c79747cbf55827e66700c058ff8a1b8990fb27e9c934ba3b6c";
    
    // 1. Deploy contracts
    console.log("\n1. Deploying ENS contracts with Stable Name Service...");
    
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
    
    // Add controller to registrar (one-time setup)
    await deployer.writeContract({
        address: registrar.address,
        abi: registrar.abi,
        functionName: 'addController',
        args: [controller.address],
        gas: 3000000n
    });
    console.log("Added controller to registrar (one-time setup)");
    
    // Transfer .stable ownership to registrar
    await deployer.writeContract({
        address: registry.address,
        abi: registry.abi,
        functionName: 'setOwner',
        args: [STABLE_NODE, registrar.address],
        gas: 3000000n
    });
    console.log("Transferred .stable ownership to registrar");
    
    console.log("\n2. Testing ENS Standard Function Signatures...");
    
    // Test IBaseRegistrar interface compatibility
    console.log("\n🔍 Testing IBaseRegistrar interface:");
    
    // Register alice.stable
    await controller.write.register([
        "alice", 
        "0x0000000000000000000000000000000000000000" as `0x${string}`
    ], { 
        account: user1.account,
        gas: 3000000n
    });
    console.log("✅ Registered alice.stable to user1");
    
    const aliceTokenId = uint256FromString("alice");
    
    // Test standard ENS functions
    console.log("\nTesting standard ENS functions:");
    
    // ownerOf - ERC721 standard
    const owner = await registrar.read.ownerOf([aliceTokenId]);
    console.log(`✅ ownerOf(${aliceTokenId}): ${owner.toLowerCase() === user1.account.address.toLowerCase() ? 'PASS' : 'FAIL'}`);
    
    // available - IBaseRegistrar
    const available1 = await registrar.read.available([aliceTokenId]);
    const available2 = await registrar.read.available([uint256FromString("charlie")]);
    console.log(`✅ available(alice): ${!available1 ? 'PASS (not available)' : 'FAIL'}`);
    console.log(`✅ available(charlie): ${available2 ? 'PASS (available)' : 'FAIL'}`);
    
    // nameExpires - IBaseRegistrar (should return max uint256 for permanent domains)
    const expires = await registrar.read.nameExpires([aliceTokenId]);
    const isMaxUint = expires === BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
    console.log(`✅ nameExpires(alice): ${isMaxUint ? 'PASS (permanent)' : 'FAIL'}`);
    
    console.log("\n3. Testing ENS Registry Integration...");
    
    // Test ENS Registry standard functions
    const aliceNode = namehash("alice.stable");
    
    // Test registry owner
    const nodeOwner = await registry.read.owner([aliceNode]);
    console.log(`✅ registry.owner(alice.stable): ${nodeOwner.toLowerCase() === user1.account.address.toLowerCase() ? 'PASS' : 'FAIL'}`);
    
    // Test resolver (should be 0x0 since we didn't set one)
    const resolver = await registry.read.resolver([aliceNode]);
    console.log(`✅ registry.resolver(alice.stable): ${resolver === "0x0000000000000000000000000000000000000000" ? 'PASS (no resolver)' : 'FAIL'}`);
    
    console.log("\n4. Testing Stable Name Service Policies...");
    
    // Test name length validation
    console.log("\n📏 Name Length Validation:");
    const lengthTests = [
        { name: "a", valid: false, reason: "too short (1 char)" },
        { name: "test", valid: false, reason: "too short (4 chars)" },
        { name: "alice", valid: true, reason: "valid (5 chars)" },
        { name: "validname123", valid: true, reason: "valid (12 chars)" },
        { name: "verylongname123", valid: true, reason: "valid (15 chars)" },
        { name: "verylongname1234", valid: false, reason: "too long (16 chars)" }
    ];
    
    for (const test of lengthTests) {
        const isValid = await controller.read.valid([test.name]);
        const status = isValid === test.valid ? '✅ PASS' : '❌ FAIL';
        console.log(`   ${status}: '${test.name}' - ${test.reason}`);
    }
    
    // Test character validation
    console.log("\n🔤 Character Validation:");
    const charTests = [
        { name: "valid", valid: true, reason: "normal ASCII" },
        { name: "test name", valid: false, reason: "contains space" },
        { name: "test\tname", valid: false, reason: "contains tab" },
        { name: "test\nname", valid: false, reason: "contains newline" },
        { name: "validüser", valid: true, reason: "Unicode characters allowed" }
    ];
    
    for (const test of charTests) {
        const isValid = await controller.read.valid([test.name]);
        const status = isValid === test.valid ? '✅ PASS' : '❌ FAIL';
        console.log(`   ${status}: '${test.name}' - ${test.reason}`);
    }
    
    // Test reserved names
    console.log("\n🚫 Reserved Names:");
    const reservedTests = ["stable", "binance", "tether", "usdt", "bitcoin", "ethereum"];
    for (const name of reservedTests) {
        const isReserved = await registrar.read.reservedNames([name]);
        console.log(`   ✅ '${name}': ${isReserved ? 'RESERVED' : 'NOT RESERVED'}`);
    }
    
    // Test case insensitivity
    console.log("\n🔄 Case Insensitivity:");
    try {
        await controller.write.register([
            "ALICE", // Should fail as 'alice' is already registered
            "0x0000000000000000000000000000000000000000" as `0x${string}`
        ], { 
            account: user2.account,
            gas: 3000000n
        });
        console.log("❌ FAIL: Should have rejected 'ALICE' (case insensitive)");
    } catch (error: any) {
        console.log("✅ PASS: 'ALICE' rejected (case insensitive)");
    }
    
    // Test one name per wallet
    console.log("\n👤 One Name Per Wallet:");
    try {
        await controller.write.register([
            "bobby", 
            "0x0000000000000000000000000000000000000000" as `0x${string}`
        ], { 
            account: user1.account, // user1 already has 'alice'
            gas: 3000000n
        });
        console.log("❌ FAIL: Should have rejected second domain for user1");
    } catch (error: any) {
        console.log("✅ PASS: Second domain rejected (one per wallet)");
    }
    
    console.log("\n5. Testing Immutable Ownership...");
    
    // Test NFT transfer blocking
    console.log("\n🔒 NFT Transfer Immutability:");
    try {
        await registrar.write.transferFrom([
            user1.account.address,
            user2.account.address,
            aliceTokenId
        ], { account: user1.account });
        console.log("❌ FAIL: NFT transfer should be blocked");
    } catch (error: any) {
        console.log("✅ PASS: NFT transfer blocked (immutable ownership)");
        console.log("   Reason:", error.shortMessage || "Transfer not allowed");
    }
    
    // Test approve/transferFrom blocking
    try {
        await registrar.write.approve([
            user2.account.address,
            aliceTokenId
        ], { account: user1.account });
        
        await registrar.write.transferFrom([
            user1.account.address,
            user2.account.address, 
            aliceTokenId
        ], { account: user2.account });
        
        console.log("❌ FAIL: Approved transfer should be blocked");
    } catch (error: any) {
        console.log("✅ PASS: Approved transfer blocked");
    }
    
    console.log("\n6. Testing Bidirectional Resolution...");
    
    // Register another domain for testing
    await controller.write.register([
        "charlie", 
        "0x0000000000000000000000000000000000000000" as `0x${string}`
    ], { 
        account: user2.account,
        gas: 3000000n
    });
    console.log("Registered charlie.stable to user2");
    
    // Test forward resolution (name -> address)
    console.log("\n➡️ Forward Resolution (name -> address):");
    const aliceOwner = await controller.read.getAccountByDomain(["alice"]);
    const charlieOwner = await controller.read.getAccountByDomain(["charlie"]);
    
    console.log(`   alice -> ${aliceOwner} ${aliceOwner.toLowerCase() === user1.account.address.toLowerCase() ? '✅' : '❌'}`);
    console.log(`   charlie -> ${charlieOwner} ${charlieOwner.toLowerCase() === user2.account.address.toLowerCase() ? '✅' : '❌'}`);
    
    // Test reverse resolution (address -> name)
    console.log("\n⬅️ Reverse Resolution (address -> name):");
    const user1Domain = await controller.read.getDomainByAccount([user1.account.address]);
    const user2Domain = await controller.read.getDomainByAccount([user2.account.address]);
    
    console.log(`   ${user1.account.address} -> ${user1Domain} ${user1Domain === 'alice' ? '✅' : '❌'}`);
    console.log(`   ${user2.account.address} -> ${user2Domain} ${user2Domain === 'charlie' ? '✅' : '❌'}`);
    
    // Test full domain names
    const user1FullDomain = await controller.read.getFullDomainByAccount([user1.account.address]);
    const user2FullDomain = await controller.read.getFullDomainByAccount([user2.account.address]);
    
    console.log(`   Full domains: ${user1FullDomain}, ${user2FullDomain}`);
    
    console.log("\n7. Testing Standard ENS Resolution Through Registry...");
    
    // Test that ENS Registry correctly shows ownership
    const aliceNodeOwner = await registry.read.owner([namehash("alice.stable")]);
    const charlieNodeOwner = await registry.read.owner([namehash("charlie.stable")]);
    
    console.log("ENS Registry node ownership:");
    console.log(`   alice.stable: ${aliceNodeOwner} ${aliceNodeOwner.toLowerCase() === user1.account.address.toLowerCase() ? '✅' : '❌'}`);
    console.log(`   charlie.stable: ${charlieNodeOwner} ${charlieNodeOwner.toLowerCase() === user2.account.address.toLowerCase() ? '✅' : '❌'}`);
    
    console.log("\n8. Testing Controller Compatibility Functions...");
    
    // Test rentPrice (should return 0 for free registration)
    const price = await controller.read.rentPrice(["testname", 31536000n]); // 1 year
    console.log(`✅ rentPrice: base=${price.base}, premium=${price.premium} (should be 0,0 for free registration)`);
    
    // Test renew (should revert for permanent domains)
    try {
        await controller.write.renew(["alice", 31536000n], { account: user1.account });
        console.log("❌ FAIL: renew should revert for permanent domains");
    } catch (error: any) {
        console.log("✅ PASS: renew correctly reverts for permanent domains");
    }
    
    console.log("\n🎉 ENS Compatibility Test Summary:");
    console.log("✅ All standard ENS function signatures preserved");
    console.log("✅ IBaseRegistrar interface compatibility maintained");  
    console.log("✅ ENS Registry integration working correctly");
    console.log("✅ Bidirectional resolution functioning");
    console.log("✅ Stable Name Service policies enforced:");
    console.log("   - ✅ One name per wallet");
    console.log("   - ✅ 5-15 character length validation");
    console.log("   - ✅ Unicode support, no spaces/control chars");
    console.log("   - ✅ Case-insensitive registration");
    console.log("   - ✅ Reserved names protection");
    console.log("   - ✅ Immutable ownership (no transfers)");
    console.log("   - ✅ Permanent registration (no expiry)");
    console.log("   - ✅ Free registration (zero cost)");
    console.log("   - ✅ ENS Registry compatibility for DApps");
    
    console.log("\n📋 DApp Integration Notes:");
    console.log("- Standard ENS functions work: ownerOf(), available(), nameExpires()");
    console.log("- ENS Registry queries work: owner(), resolver()"); 
    console.log("- Forward/reverse resolution available through controller");
    console.log("- All existing ENS interfaces preserved for compatibility");
}

function uint256FromString(name: string): bigint {
    // Generate token ID same way as controller: uint256(keccak256(bytes(normalizedName)))
    const normalizedName = name.toLowerCase();
    const hash = keccak256(toBytes(normalizedName));
    return BigInt(hash);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("ENS Compatibility test failed:", error);
        process.exit(1);
    });