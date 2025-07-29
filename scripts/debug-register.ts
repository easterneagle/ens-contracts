import hre from "hardhat";

async function main() {
    console.log("Debugging register function...");
    
    const [deployer, user1] = await hre.viem.getWalletClients();
    
    const STABLE_NODE = "0xbc67d859e38ff2c79747cbf55827e66700c058ff8a1b8990fb27e9c934ba3b6c";
    
    // Deploy contracts
    const registry = await hre.viem.deployContract("ENSRegistry", []);
    console.log("ENSRegistry deployed to:", registry.address);
    
    const stableLabel = "0x5802f6cb6a8bdbe0204d6c66324b68cf9295a374b94261674e8d2e4a11d53ad5";
    await deployer.writeContract({
        address: registry.address,
        abi: registry.abi,
        functionName: 'setSubnodeOwner',
        args: ["0x0000000000000000000000000000000000000000000000000000000000000000", stableLabel, deployer.account.address],
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
    
    // Add controller
    await deployer.writeContract({
        address: registrar.address,
        abi: registrar.abi,
        functionName: 'addController',
        args: [controller.address],
        gas: 3000000n
    });
    console.log("Controller added");
    
    // Transfer ownership
    await deployer.writeContract({
        address: registry.address,
        abi: registry.abi,
        functionName: 'setOwner',
        args: [STABLE_NODE, registrar.address],
        gas: 3000000n
    });
    console.log("Ownership transferred");
    
    // Check status before register
    console.log("\nBefore register:");
    const hasRegistered = await registrar.read.hasRegistered([user1.account.address]);
    console.log("User1 hasRegistered:", hasRegistered);
    
    const nameAvailable = await controller.read.available(["alice"]);
    console.log("alice available:", nameAvailable);
    
    const nameValid = await controller.read.valid(["alice"]);
    console.log("alice valid:", nameValid);
    
    // Try to register
    console.log("\nTrying to register...");
    try {
        await controller.write.register([
            "alice", 
            "0x0000000000000000000000000000000000000000" as `0x${string}`
        ], { 
            account: user1.account,
            gas: 3000000n
        });
        console.log("✅ Registration successful!");
    } catch (error: any) {
        console.log("❌ Registration failed:", error.shortMessage || error.message);
        
        // Let's try to get more details
        try {
            const result = await controller.simulate.register([
                "alice", 
                "0x0000000000000000000000000000000000000000" as `0x${string}`
            ], { 
                account: user1.account
            });
            console.log("Simulation result:", result);
        } catch (simError: any) {
            console.log("Simulation also failed:", simError.shortMessage || simError.message);
        }
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Debug failed:", error);
        process.exit(1);
    });