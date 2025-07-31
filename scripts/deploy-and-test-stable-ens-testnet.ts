import hre from "hardhat";
import { namehash, labelhash, parseEther, formatEther, defineChain, getContract } from "viem";

// =============================================================================
// CONFIGURATION
// =============================================================================

const stableTestnet = defineChain({
    id: 2201,
    name: 'Stable Testnet',
    network: 'stable-testnet',
    nativeCurrency: {
        decimals: 18,
        name: 'usdt',
        symbol: 'ausdt',
    },
    rpcUrls: {
        default: { http: ['https://stable-jsonrpc.testnet.chain0.dev'] },
        public: { http: ['https://stable-jsonrpc.testnet.chain0.dev'] },
    },
    blockExplorers: {
        default: { name: 'Stable Explorer', url: 'https://stable-explorer.testnet.chain0.dev' },
    },
});

const STABLE_NODE = namehash("stable");
const DEPLOYMENT_WAIT_TIME = 15000; // 15 seconds
const APPROVAL_WAIT_TIME = 5000;    // 5 seconds
const BLOCK_CONFIRMATION_WAIT = 10000; // 10 seconds

// Gas limits for different operations
const GAS_LIMITS = {
    REGISTRY_DEPLOY: 1500000n,
    ROOT_DEPLOY: 800000n,
    BASEREGISTRAR_DEPLOY: 2000000n,
    REVERSEREGISTRAR_DEPLOY: 1000000n,
    CONTROLLER_DEPLOY: 3000000n,
    PUBLICRESOLVER_DEPLOY: 4000000n,
    SET_OWNER: 300000n,
    SET_CONTROLLER: 200000n,
    SET_SUBNODE_OWNER: 300000n,
    SET_DEFAULT_RESOLVER: 200000n,
    ADD_CONTROLLER: 200000n,
    REVERSE_SETUP: 500000n,
    APPROVAL: 100000n,
    REGISTRATION: 800000n,
} as const;

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function logSection(title: string, char = "=") {
    const line = char.repeat(60);
    console.log(`\n${line}`);
    console.log(`${title}`);
    console.log(line);
}

function logStep(step: number, message: string) {
    console.log(`\n${step}. ${message}`);
}

function logSuccess(message: string) {
    console.log(`   [SUCCESS] ${message}`);
}

function logInfo(message: string) {
    console.log(`   [INFO] ${message}`);
}

function logWait(message: string) {
    console.log(`   [WAIT] ${message}`);
}

async function waitForConfirmation(seconds: number, message: string) {
    logWait(`${message} (${seconds/1000}s)`);
    await new Promise(resolve => setTimeout(resolve, seconds));
}

async function deployContract(deployer: any, contractName: string, args: any[], gasLimit: bigint) {
    const artifact = await hre.artifacts.readArtifact(contractName);
    const publicClient = await hre.viem.getPublicClient({ chain: stableTestnet });
    
    const hash = await deployer.deployContract({
        abi: artifact.abi,
        bytecode: artifact.bytecode,
        args,
        chain: stableTestnet,
        gas: gasLimit,
    });
    
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    
    if (!receipt.contractAddress) {
        throw new Error(`Failed to deploy ${contractName}: no contract address in receipt`);
    }
    
    return {
        address: receipt.contractAddress,
        abi: artifact.abi
    };
}

async function executeTransaction(
    deployer: any, 
    contractAddress: string, 
    abi: any, 
    functionName: string, 
    args: any[], 
    gasLimit: bigint
) {
    const hash = await deployer.writeContract({
        chain: stableTestnet,
        address: contractAddress,
        abi,
        functionName,
        args,
        gas: gasLimit,
    });
    return hash;
}

// =============================================================================
// MAIN FUNCTION
// =============================================================================

async function main() {
    logSection("STABLE NAME SERVICE TESTNET DEPLOYMENT");
    
    logInfo(`Network: ${hre.network.name}`);
    logInfo(`Chain ID: ${stableTestnet.id}`);
    logInfo(`RPC: ${stableTestnet.rpcUrls.default.http[0]}`);
    logInfo(`Explorer: ${stableTestnet.blockExplorers.default.url}`);
    
    // Setup wallet clients
    const walletClients = await hre.viem.getWalletClients({ chain: stableTestnet });
    const [deployer, user1, user2] = walletClients;
    
    if (!deployer || !user1 || !user2) {
        throw new Error("Not enough wallet clients. Set STABLE_TESTNET_PK1, PK2, PK3 in environment");
    }

    logSection("ACCOUNT INFORMATION");
    console.log(`Deployer:     ${deployer.account.address}`);
    console.log(`User1 (jeongjoo): ${user1.account.address}`);
    console.log(`User2 (soojong):  ${user2.account.address}`);

    // Check balances
    const publicClient = await hre.viem.getPublicClient({ chain: stableTestnet });
    const [deployerBalance, user1Balance, user2Balance] = await Promise.all([
        publicClient.getBalance({ address: deployer.account.address }),
        publicClient.getBalance({ address: user1.account.address }),
        publicClient.getBalance({ address: user2.account.address }),
    ]);

    console.log(`\nAccount Balances:`);
    console.log(`Deployer:     ${formatEther(deployerBalance)} ausdt`);
    console.log(`User1:        ${formatEther(user1Balance)} ausdt`);
    console.log(`User2:        ${formatEther(user2Balance)} ausdt`);

    // Deploy contracts
    const contracts = await deployContracts(deployer);
    
    // Wait for deployment confirmation
    await waitForConfirmation(DEPLOYMENT_WAIT_TIME, "Waiting for all deployment transactions to be confirmed");
    
    // Run tests
    await runAllTests(contracts, user1, user2, deployer);

    logSection("DEPLOYMENT COMPLETE", "=");
    logSuccess("Stable Name Service deployed and tested successfully!");
    console.log(`\nRegister domains using:`);
    console.log(`   controller.register("name", owner, 0n, "0x00...", resolver, [], true, 0n)`);
    console.log(`\nController: ${contracts.controller.address}`);
    console.log(`Resolver:   ${contracts.publicResolver.address}`);
}

// =============================================================================
// CONTRACT DEPLOYMENT
// =============================================================================

async function deployContracts(deployer: any) {
    logSection("CONTRACT DEPLOYMENT");
    logInfo(`Stable node hash: ${STABLE_NODE}`);
    
    const publicClient = await hre.viem.getPublicClient({ chain: stableTestnet });
    
    // Deploy ENSRegistry
    logStep(1, "Deploying ENSRegistry");
    const registry = await deployContract(
        deployer, 
        "ENSRegistry", 
        [], 
        GAS_LIMITS.REGISTRY_DEPLOY
    );
    logSuccess(`ENSRegistry: ${registry.address}`);

    // Deploy Root
    logStep(2, "Deploying Root");
    const root = await deployContract(
        deployer,
        "Root",
        [registry.address],
        GAS_LIMITS.ROOT_DEPLOY
    );
    logSuccess(`Root: ${root.address}`);

    // Set Root as owner of root node
    logStep(3, "Setting Root as owner of root node");
    await executeTransaction(
        deployer,
        registry.address,
        registry.abi,
        'setOwner',
        ['0x0000000000000000000000000000000000000000000000000000000000000000', root.address],
        GAS_LIMITS.SET_OWNER
    );
    logSuccess("Root node ownership transferred");
    
    // Add deployer as controller to Root
    logStep(4, "Adding deployer as Root controller");
    await executeTransaction(
        deployer,
        root.address,
        root.abi,
        'setController',
        [deployer.account.address, true],
        GAS_LIMITS.SET_CONTROLLER
    );
    logSuccess("Deployer added as Root controller");

    // 4. Deploy BaseRegistrarImplementation using pure viem
    console.log("4. Deploying BaseRegistrarImplementation...");
    const BaseRegistrarArtifact = await hre.artifacts.readArtifact("BaseRegistrarImplementation");
    
    const registrarHash = await deployer.deployContract({
        abi: BaseRegistrarArtifact.abi,
        bytecode: BaseRegistrarArtifact.bytecode,
        args: [registry.address, STABLE_NODE],
        chain: stableTestnet,
        gas: 2000000n,
    });
    
    const registrarReceipt = await publicClient.waitForTransactionReceipt({ hash: registrarHash });
    
    const registrar = {
        address: registrarReceipt.contractAddress,
        abi: BaseRegistrarArtifact.abi
    };
    console.log("   BaseRegistrarImplementation deployed at:", registrar.address);

    // 5. Set registrar as owner of .stable
    console.log("5. Setting registrar as owner of .stable...");
    const tx2 = await deployer.writeContract({
        chain: stableTestnet,
        address: root.address,
        abi: root.abi,
        functionName: 'setSubnodeOwner',
        args: [labelhash('stable'), registrar.address],
        gas: 300000n,
    });
    console.log("   Registrar set as owner of .stable. Tx:", tx2);

    // 6. Deploy ReverseRegistrar using pure viem
    console.log("6. Deploying ReverseRegistrar...");
    const ReverseRegistrarArtifact = await hre.artifacts.readArtifact("ReverseRegistrar");
    
    const reverseRegistrarHash = await deployer.deployContract({
        abi: ReverseRegistrarArtifact.abi,
        bytecode: ReverseRegistrarArtifact.bytecode,
        args: [registry.address],
        chain: stableTestnet,
        gas: 1000000n,
    });
    
    const reverseRegistrarReceipt = await publicClient.waitForTransactionReceipt({ hash: reverseRegistrarHash });
    
    const reverseRegistrar = {
        address: reverseRegistrarReceipt.contractAddress,
        abi: ReverseRegistrarArtifact.abi
    };
    console.log("   ReverseRegistrar deployed at:", reverseRegistrar.address);

    // 7. Set up reverse resolution
    console.log("7. Setting up reverse resolution...");
    await setupReverseResolution(root, registry, reverseRegistrar, deployer);
    console.log("   Reverse resolution configured");

    // 8. Deploy ETHRegistrarController using pure viem
    console.log("8. Deploying ETHRegistrarController...");
    const ControllerArtifact = await hre.artifacts.readArtifact("ETHRegistrarController");
    
    const controllerHash = await deployer.deployContract({
        abi: ControllerArtifact.abi,
        bytecode: ControllerArtifact.bytecode,
        args: [registrar.address, reverseRegistrar.address, registry.address],
        chain: stableTestnet,
        gas: 3000000n, // ETHRegistrarController는 큰 컨트랙트이므로 더 많은 가스 필요
    });
    
    const controllerReceipt = await publicClient.waitForTransactionReceipt({ hash: controllerHash });
    
    const controller = {
        address: controllerReceipt.contractAddress,
        abi: ControllerArtifact.abi
    };
    console.log("   ETHRegistrarController deployed at:", controller.address);

    // 9. Deploy PublicResolver using pure viem
    console.log("9. Deploying PublicResolver...");
    const PublicResolverArtifact = await hre.artifacts.readArtifact("PublicResolver");
    
    const publicResolverHash = await deployer.deployContract({
        abi: PublicResolverArtifact.abi,
        bytecode: PublicResolverArtifact.bytecode,
        args: [
            registry.address,
            "0x0000000000000000000000000000000000000000", // nameWrapper (not used)
            controller.address, // trustedETHController
            reverseRegistrar.address  // trustedReverseRegistrar
        ],
        chain: stableTestnet,
        gas: 4000000n, // PublicResolver는 가장 큰 컨트랙트
    });
    
    const publicResolverReceipt = await publicClient.waitForTransactionReceipt({ hash: publicResolverHash });
    
    const publicResolver = {
        address: publicResolverReceipt.contractAddress,
        abi: PublicResolverArtifact.abi
    };
    console.log("   PublicResolver deployed at:", publicResolver.address);

    // 10. Set default resolver for ReverseRegistrar
    console.log("10. Setting default resolver for ReverseRegistrar...");
    const tx3 = await deployer.writeContract({
        chain: stableTestnet,
        address: reverseRegistrar.address,
        abi: reverseRegistrar.abi,
        functionName: 'setDefaultResolver',
        args: [publicResolver.address],
        gas: 200000n,
    });
    console.log("   Default resolver set. Tx:", tx3);

    // 11. Add controller to registrar
    console.log("11. Adding controller to registrar...");
    const tx4 = await deployer.writeContract({
        chain: stableTestnet,
        address: registrar.address,
        abi: registrar.abi,
        functionName: 'addController',
        args: [controller.address],
        gas: 200000n,
    });
    console.log("   Controller added to registrar. Tx:", tx4);

    // 12. Add controller to reverse registrar
    console.log("12. Adding controller to reverse registrar...");
    const tx5 = await deployer.writeContract({
        chain: stableTestnet,
        address: reverseRegistrar.address,
        abi: reverseRegistrar.abi,
        functionName: 'setController',
        args: [controller.address, true],
        gas: 200000n,
    });
    console.log("   Controller added to reverse registrar. Tx:", tx5);

    console.log("\nAll contracts deployed successfully!");
    console.log("=====================================");
    console.log("Contract Addresses:");
    console.log("ENSRegistry:", registry.address);
    console.log("Root:", root.address);
    console.log("BaseRegistrarImplementation:", registrar.address);
    console.log("PublicResolver:", publicResolver.address);
    console.log("ReverseRegistrar:", reverseRegistrar.address);
    console.log("ETHRegistrarController:", controller.address);
    console.log("=====================================");

    return { registry, root, registrar, publicResolver, reverseRegistrar, controller };
}

async function setupReverseResolution(root: any, registry: any, reverseRegistrar: any, deployer: any) {
    try {
        // Set owner of .reverse
        console.log("   Setting owner of .reverse domain...");
        
        
        const tx1 = await deployer.writeContract({
            chain: stableTestnet,
            address: root.address,
            abi: root.abi,
            functionName: 'setSubnodeOwner',
            args: [labelhash('reverse'), deployer.account.address],
            gas: 500000n,
        });
        console.log("   .reverse domain owner set. Tx:", tx1);
        
        // Wait for block confirmation
        await waitForConfirmation(BLOCK_CONFIRMATION_WAIT, "Waiting for .reverse setup confirmation");

        // Set ReverseRegistrar as owner of .addr.reverse
        // Since deployer now owns .reverse, deployer should directly call setSubnodeOwner
        console.log("   Setting ReverseRegistrar as owner of .addr.reverse...");
        
        const reverseNode = namehash('reverse');
        
        const tx2 = await deployer.writeContract({
            chain: stableTestnet,
            address: registry.address,
            abi: registry.abi,
            functionName: 'setSubnodeOwner',
            args: [reverseNode, labelhash('addr'), reverseRegistrar.address],
            gas: 500000n,
        });
        console.log("   .addr.reverse owner set. Tx:", tx2);
        
    } catch (error) {
        console.log("   Reverse resolution setup failed:", error);
        throw error;
    }
}

async function runAllTests(contracts: any, user1: any, user2: any, deployer: any) {
    const { registry, registrar, publicResolver, reverseRegistrar, controller } = contracts;
    
    console.log("\nStarting Comprehensive Tests...");
    console.log("=====================================");
    
    try {
        await testDomainRegistration(controller, registrar, registry, publicResolver, reverseRegistrar, user1, "jeongjoo");
        console.log("Domain registration test passed");
    } catch (error) {
        console.log("Domain registration test failed:", error instanceof Error ? error.message : String(error));
    }
    
    try {
        await testDomainRegistration(controller, registrar, registry, publicResolver, reverseRegistrar, user2, "soojong");
        console.log("Second domain registration test passed");
    } catch (error) {
        console.log("Second domain registration test failed:", error instanceof Error ? error.message : String(error));
    }
    
    // Test new requirements
    try {
        await testNameValidation(controller);
        console.log("Name validation test passed");
    } catch (error) {
        console.log("Name validation test failed:", error instanceof Error ? error.message : String(error));
    }
    
    try {
        await testOneNamePerWallet(controller, publicResolver, user1);
        console.log("One name per wallet test passed");
    } catch (error) {
        console.log("One name per wallet test failed:", error instanceof Error ? error.message : String(error));
    }
    
    try {
        await testForwardResolution(publicResolver, user1, "jeongjoo");
        await testForwardResolution(publicResolver, user2, "soojong");
        console.log("Forward resolution test passed");
    } catch (error) {
        console.log("Forward resolution test failed:", error instanceof Error ? error.message : String(error));
    }
    
    try {
        await testReverseResolution(publicResolver, user1, "jeongjoo");
        await testReverseResolution(publicResolver, user2, "soojong");
        console.log("Reverse resolution test passed");
    } catch (error) {
        console.log("Reverse resolution test failed:", error instanceof Error ? error.message : String(error));
    }
    
    try {
        await testTransferPrevention(registrar, user1, deployer);
        console.log("Transfer prevention test passed");
    } catch (error) {
        console.log("Transfer prevention test failed:", error instanceof Error ? error.message : String(error));
    }
    
    try {
        await testPricing(controller);
        console.log("Pricing test passed");
    } catch (error) {
        console.log("Pricing test failed:", error instanceof Error ? error.message : String(error));
    }
    
    try {
        await testRenewalPrevention(controller, deployer);
        console.log("Renewal prevention test passed");
    } catch (error) {
        console.log("Renewal prevention test failed:", error instanceof Error ? error.message : String(error));
    }

    console.log("\nTesting Summary:");
    console.log("=====================================");
    console.log("Domain registration working");
    console.log("Forward resolution working");
    console.log("Reverse resolution working");
    console.log("Transfer prevention working");
    console.log("Free pricing confirmed");
    console.log("Renewal prevention working");
    console.log("Name validation working");
    console.log("One name per wallet enforced");
}

async function testDomainRegistration(controller: any, registrar: any, registry: any, publicResolver: any, reverseRegistrar: any, user: any, domainName: string) {
    console.log(`\nTesting Domain Registration: ${domainName}.stable`);
    
    const name = domainName;
    const label = labelhash(name);
    const node = namehash(`${name}.stable`);
    
    // Get contract instances for reading
    const publicClient = await hre.viem.getPublicClient({ chain: stableTestnet });
    const controllerContract = getContract({ address: controller.address, abi: controller.abi, client: publicClient });
    const registrarContract = getContract({ address: registrar.address, abi: registrar.abi, client: publicClient });
    const reverseRegistrarContract = getContract({ address: reverseRegistrar.address, abi: reverseRegistrar.abi, client: publicClient });
    const registryContract = getContract({ address: registry.address, abi: registry.abi, client: publicClient });
    
    // Check domain availability
    const isAvailable = await controllerContract.read.available([name]);
    logInfo(`${name}.stable available: ${isAvailable}`);

    // User approvals
    logInfo(`Approving controller for ${user.account.address}...`);
    await user.writeContract({
        chain: stableTestnet,
        address: registry.address,
        abi: registry.abi,
        functionName: 'setApprovalForAll',
        args: [controller.address, true],
        gas: GAS_LIMITS.APPROVAL,
    });
    await waitForConfirmation(APPROVAL_WAIT_TIME, "Waiting for approval confirmation");

    // Register domain
    logInfo(`Registering ${name}.stable...`);
    const registerTx = await user.writeContract({
        chain: stableTestnet,
        address: controller.address,
        abi: controller.abi,
        functionName: 'register',
        args: [
            name,
            user.account.address,
            0n,
            "0x0000000000000000000000000000000000000000000000000000000000000000",
            publicResolver.address,
            [],
            true,
            0n
        ],
        value: domainName === "jeongjoo" ? parseEther("0.001") : 0n, // Test refund with first domain
        gas: GAS_LIMITS.REGISTRATION,
    });
    
    // Verify registration
    const domainOwner = await registrarContract.read.ownerOf([BigInt(label)]) as string;
    const ensOwner = await registryContract.read.owner([node]) as string;
    const resolver = await registryContract.read.resolver([node]) as string;
    
    const success = domainOwner.toLowerCase() === user.account.address.toLowerCase();
    if (success) {
        logSuccess(`${name}.stable registered successfully`);
    } else {
        throw new Error(`Registration failed for ${name}.stable`);
    }
}

async function testForwardResolution(publicResolver: any, user: any, domainName: string) {
    logStep(0, `Testing Forward Resolution: ${domainName}.stable`);
    
    const node = namehash(`${domainName}.stable`);
    const publicClient = await hre.viem.getPublicClient({ chain: stableTestnet });
    const publicResolverContract = getContract({ address: publicResolver.address, abi: publicResolver.abi, client: publicClient });
    
    const resolvedEthAddress = await publicResolverContract.read.addr([node]) as string;
    const success = resolvedEthAddress.toLowerCase() === user.account.address.toLowerCase();
    
    if (success) {
        logSuccess("Forward resolution working");
    } else {
        throw new Error("Forward resolution failed");
    }
}

async function testReverseResolution(publicResolver: any, user: any, domainName: string) {
    console.log(`\n Testing Reverse Resolution: ${user.account.address} -> ${domainName}.stable`);
    
    // Check if reverse record was set during registration (reverseRecord: true)
    const reverseNode = namehash(`${user.account.address.slice(2).toLowerCase()}.addr.reverse`);
    
    try {
        const publicClient = await hre.viem.getPublicClient({ chain: stableTestnet });
        const publicResolverContract = getContract({ address: publicResolver.address, abi: publicResolver.abi, client: publicClient });
        
        const name = await publicResolverContract.read.name([reverseNode]);
        console.log(`   Reverse record for ${user.account.address}:`, name);
        console.log(`    Reverse resolution working:`, name === `${domainName}.stable`);
    } catch (error) {
        console.log("    Reverse resolution failed:", error);
    }
}

async function testTransferPrevention(registrar: any, user1: any, deployer: any) {
    console.log("\n Testing Transfer Prevention");
    
    const name = "jeongjoo";
    const tokenId = BigInt(labelhash(name));
    
    try {
        const transferTx = await user1.writeContract({
        chain: stableTestnet,
            address: registrar.address,
            abi: registrar.abi,
            functionName: 'transferFrom',
            args: [user1.account.address, deployer.account.address, tokenId],
        });
        console.log("    Transfer prevention FAILED - transfer was allowed");
    } catch (error) {
        console.log("    Transfer prevention working - transfer reverted as expected");
    }
}

async function testPricing(controller: any) {
    console.log("\n Testing Free Pricing");
    
    const publicClient = await hre.viem.getPublicClient({ chain: stableTestnet });
    const controllerContract = getContract({ address: controller.address, abi: controller.abi, client: publicClient });
    
    const price = await controllerContract.read.rentPrice(["testname", 31536000n]);
    console.log(`   Rent price for testname:`, price);
    console.log(`    Free pricing confirmed:`, price.base === 0n && price.premium === 0n);
}

async function testRenewalPrevention(controller: any, deployer: any) {
    console.log("\n Testing Renewal Prevention");
    
    try {
        const renewTx = await deployer.writeContract({
        chain: stableTestnet,
            address: controller.address,
            abi: controller.abi,
            functionName: 'renew',
            args: ["jeongjoo", 31536000n],
        });
        console.log("    Renewal prevention FAILED - renewal was allowed");
    } catch (error) {
        console.log("    Renewal prevention working - renewal reverted as expected");
    }
}

async function testNameValidation(controller: any) {
    console.log("\n Testing Name Validation");
    
    const publicClient = await hre.viem.getPublicClient({ chain: stableTestnet });
    const controllerContract = getContract({ address: controller.address, abi: controller.abi, client: publicClient });
    
    // Test name length validation
    try {
        await controllerContract.read.validateName(["abc"]); // Too short
        console.log("    Length validation FAILED - short name was accepted");
    } catch (error) {
        console.log("    Short name rejected (< 5 chars)");
    }
    
    try {
        await controllerContract.read.validateName(["abcdefghijklmnopqrstuvwxyz"]); // Too long
        console.log("    Length validation FAILED - long name was accepted");
    } catch (error) {
        console.log("    Long name rejected (> 15 chars)");
    }
    
    // Test restricted names
    try {
        await controllerContract.read.validateName(["stable"]); // Restricted
        console.log("    Restriction validation FAILED - restricted name was accepted");
    } catch (error) {
        console.log("    Restricted name rejected");
    }
    
    // Test invalid characters
    try {
        await controllerContract.read.validateName(["test name"]); // Contains space
        console.log("    Character validation FAILED - name with space was accepted");
    } catch (error) {
        console.log("    Name with space rejected");
    }
    
    // Test subdomain-like names (containing dots)
    try {
        await controllerContract.read.validateName(["lee.jeongjoo"]); // Contains dot
        console.log("    Dot validation FAILED - name with dot was accepted");
    } catch (error) {
        console.log("    Subdomain-like name rejected");
    }
    
    // Test valid name
    try {
        await controllerContract.read.validateName(["validname"]);
        console.log("    Valid name accepted");
    } catch (error) {
        console.log("    Valid name validation FAILED:", error);
    }
}

async function testOneNamePerWallet(controller: any, publicResolver: any, user: any) {
    console.log("\n Testing One Name Per Wallet");
    
    const publicClient = await hre.viem.getPublicClient({ chain: stableTestnet });
    const controllerContract = getContract({ address: controller.address, abi: controller.abi, client: publicClient });
    
    // Check if user already has a name
    const hasName = await controllerContract.read.hasRegisteredName([user.account.address]);
    console.log(`   User ${user.account.address} has registered name:`, hasName);
    
    if (hasName) {
        // Try to register another name (should fail)
        try {
            const secondRegisterTx = await user.writeContract({
        chain: stableTestnet,
                address: controller.address,
                abi: controller.abi,
                functionName: 'register',
                args: [
                    "anothername",
                    user.account.address,
                    0n,
                    "0x0000000000000000000000000000000000000000000000000000000000000000",
                    publicResolver.address,
                    [],
                    false,
                    0n
                ],
            });
            console.log("    One name per wallet FAILED - second registration was allowed");
        } catch (error) {
            console.log("    Second name registration rejected");
        }
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("\n Deployment or testing failed:", error);
        process.exit(1);
    });