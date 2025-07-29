import { ethers } from "hardhat";

async function main() {
    console.log("Deploying ENS with .stable TLD for testnet...");
    
    const [deployer] = await ethers.getSigners();
    console.log("Deploying with account:", deployer.address);
    console.log("Account balance:", (await deployer.getBalance()).toString());
    
    // STABLE_NODE = keccak256(abi.encodePacked(bytes32(0), keccak256('stable')))
    const STABLE_NODE = "0x7ba6ed1633197e59c86f2b2719de3bfad7e176c281dcf2b468c16033ad78bb4e";
    
    // 1. Deploy ENSRegistry
    console.log("\n 1. Deploying ENSRegistry...");
    const ENSRegistry = await ethers.getContractFactory("ENSRegistry");
    const registry = await ENSRegistry.deploy();
    await registry.deployed();
    console.log("\n NSRegistry deployed to:", registry.address);
    
    // 2. Deploy PublicResolver
    console.log("\n 2. Deploying PublicResolver...");
    const PublicResolver = await ethers.getContractFactory("PublicResolver");
    const resolver = await PublicResolver.deploy(
        registry.address,
        ethers.constants.AddressZero, // No name wrapper
        ethers.constants.AddressZero, // No trusted controller
        ethers.constants.AddressZero  // No reverse registrar
    );
    await resolver.deployed();
    console.log("\n PublicResolver deployed to:", resolver.address);
    
    // 3. Deploy BaseRegistrarImplementation
    console.log("\n 3. Deploying BaseRegistrarImplementation...");
    const BaseRegistrar = await ethers.getContractFactory("BaseRegistrarImplementation");
    const registrar = await BaseRegistrar.deploy(registry.address, STABLE_NODE);
    await registrar.deployed();
    console.log("\n BaseRegistrarImplementation deployed to:", registrar.address);
    
    // 4. Set registrar as owner of .stable node
    console.log("\n 4. Setting up .stable TLD ownership...");
    await registry.setOwner(STABLE_NODE, registrar.address);
    console.log("\n Set registrar as owner of .stable node");
    
    // 5. Deploy ETHRegistrarController (modified for .stable and one-per-account)
    console.log("\n 5.Deploying ETHRegistrarController...");
    
    // We need a simple price oracle - deploy a dummy one
    const DummyOracle = await ethers.getContractFactory("DummyOracle");
    const priceOracle = await DummyOracle.deploy(0); // No registration fee
    await priceOracle.deployed();
    console.log("\n DummyOracle deployed to:", priceOracle.address);
    
    const ETHRegistrarController = await ethers.getContractFactory("ETHRegistrarController");
    const controller = await ETHRegistrarController.deploy(
        registrar.address,
        priceOracle.address,
        60,  // minCommitmentAge: 1 minute
        86400, // maxCommitmentAge: 1 day
        ethers.constants.AddressZero, // No reverse registrar
        ethers.constants.AddressZero, // No name wrapper
        registry.address
    );
    await controller.deployed();
    console.log("\n ETHRegistrarController deployed to:", controller.address);
    
    // 6. Add Controller as controller
    console.log("\n 6. Adding ETHRegistrarController as controller...");
    await registrar.addController(controller.address);
    console.log("\n Added ETHRegistrarController as controller");
    
    // 7. Summary
    console.log("\n Deployment complete!");
    console.log("=====================================");
    console.log("\n Contract Addresses:");
    console.log("ENSRegistry:", registry.address);
    console.log("PublicResolver:", resolver.address);
    console.log("BaseRegistrarImplementation:", registrar.address);
    console.log("DummyOracle:", priceOracle.address);
    console.log("ETHRegistrarController:", controller.address);
    console.log("=====================================");
    
    // 8. Save addresses to file
    const addresses = {
        network: await ethers.provider.getNetwork(),
        contracts: {
            ENSRegistry: registry.address,
            PublicResolver: resolver.address,
            BaseRegistrarImplementation: registrar.address,
            DummyOracle: priceOracle.address,
            ETHRegistrarController: controller.address,
        },
        constants: {
            STABLE_NODE: STABLE_NODE
        }
    };
    
    const fs = require('fs');
    fs.writeFileSync(
        './deployed-addresses.json', 
        JSON.stringify(addresses, null, 2)
    );
    console.log("💾 Addresses saved to deployed-addresses.json");
    
    console.log("\n Ready for testing! Try:");
    console.log("npx hardhat run scripts/test-registration.js --network <your-network>");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });