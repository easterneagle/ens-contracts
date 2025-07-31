//SPDX-License-Identifier: MIT
pragma solidity ~0.8.17;

import {BaseRegistrarImplementation} from "./BaseRegistrarImplementation.sol";
import {StringUtils} from "../utils/StringUtils.sol";
import {Resolver} from "../resolvers/Resolver.sol";
import {ENS} from "../registry/ENS.sol";
import {ReverseRegistrar} from "../reverseRegistrar/ReverseRegistrar.sol";
import {ReverseClaimer} from "../reverseRegistrar/ReverseClaimer.sol";
import {IETHRegistrarController, IPriceOracle} from "./IETHRegistrarController.sol";

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {INameWrapper} from "../wrapper/INameWrapper.sol";
import {ERC20Recoverable} from "../utils/ERC20Recoverable.sol";

error CommitmentTooNew(bytes32 commitment);
error CommitmentTooOld(bytes32 commitment);
error NameNotAvailable(string name);
error DurationTooShort(uint256 duration);
error ResolverRequiredWhenDataSupplied();
error UnexpiredCommitmentExists(bytes32 commitment);
error InsufficientValue();
error Unauthorised(bytes32 node);
error MaxCommitmentAgeTooLow();
error MaxCommitmentAgeTooHigh();
error NameTooShort(string name);
error NameTooLong(string name);
error InvalidCharacters(string name);
error WalletAlreadyOwnsName(address wallet);
error NameRestricted(string name);

/// @dev A registrar controller for registering and renewing names at fixed cost.
contract ETHRegistrarController is
    Ownable,
    IETHRegistrarController,
    IERC165,
    ERC20Recoverable,
    ReverseClaimer
{
    using StringUtils for *;
    using Address for address;

    bytes32 private constant STABLE_NODE =
        0xbc67d859e38ff2c79747cbf55827e66700c058ff8a1b8990fb27e9c934ba3b6c; // namehash("stable")
    BaseRegistrarImplementation immutable base;
    ReverseRegistrar public immutable reverseRegistrar;
    ENS public immutable ens;
    
    // Mapping to track if a wallet already owns a name
    mapping(address => bool) public hasRegisteredName;
    
    // Mapping for restricted names
    mapping(bytes32 => bool) public restrictedNames;

    event NameRegistered(
        string name,
        bytes32 indexed label,
        address indexed owner,
        uint256 baseCost,
        uint256 premium,
        uint256 expires
    );
    event NameRenewed(
        string name,
        bytes32 indexed label,
        uint256 cost,
        uint256 expires
    );

    constructor(
        BaseRegistrarImplementation _base,
        ReverseRegistrar _reverseRegistrar,
        ENS _ens
    ) ReverseClaimer(_ens, msg.sender) {
        base = _base;
        reverseRegistrar = _reverseRegistrar;
        ens = _ens;
        
        // Initialize restricted names
        _initializeRestrictedNames();
    }

    function rentPrice(
        string memory name,
        uint256 duration
    ) public pure override returns (IPriceOracle.Price memory price) {
        // Always return zero price (free registration)
        return IPriceOracle.Price({base: 0, premium: 0});
    }

    function valid(string memory name) public pure returns (bool) {
        uint256 len = name.strlen();
        return len >= 5 && len <= 15;
    }
    
    function validateName(string memory name) public view returns (bool) {
        // Check length (5-15 characters)
        uint256 len = name.strlen();
        if (len < 5) revert NameTooShort(name);
        if (len > 15) revert NameTooLong(name);
        
        // Check for restricted names
        bytes32 nameHash = keccak256(bytes(_toLowerCase(name)));
        if (restrictedNames[nameHash]) revert NameRestricted(name);
        
        // Check for invalid characters (dots, spaces, etc.)
        bytes memory nameBytes = bytes(name);
        for (uint i = 0; i < nameBytes.length; i++) {
            bytes1 char = nameBytes[i];
            // Reject dots (prevent subdomain-like names)
            if (char == 0x2E) revert InvalidCharacters(name); // dot "."
            // Reject spaces and other invalid characters
            if (char == 0x20) revert InvalidCharacters(name); // space
        }
        
        return true;
    }
    
    function _toLowerCase(string memory name) internal pure returns (string memory) {
        bytes memory nameBytes = bytes(name);
        bytes memory lowerName = new bytes(nameBytes.length);
        
        for (uint i = 0; i < nameBytes.length; i++) {
            bytes1 char = nameBytes[i];
            // Convert A-Z to a-z
            if (char >= 0x41 && char <= 0x5A) {
                lowerName[i] = bytes1(uint8(char) + 32);
            } else {
                lowerName[i] = char;
            }
        }
        
        return string(lowerName);
    }

    function available(string memory name) public override returns (bool) {
        bytes32 label = keccak256(bytes(name));
        bool isValid = valid(name);
        bool isBaseAvailable = base.available(uint256(label));
        // Note: cannot emit events in view functions
        return isValid && isBaseAvailable;
    }

    function makeCommitment(
        string memory name,
        address owner,
        uint256 duration,
        bytes32 secret,
        address resolver,
        bytes[] calldata data,
        bool reverseRecord,
        uint16 ownerControlledFuses
    ) public pure override returns (bytes32) {
        bytes32 label = keccak256(bytes(name));
        if (data.length > 0 && resolver == address(0)) {
            revert ResolverRequiredWhenDataSupplied();
        }
        return
            keccak256(
                abi.encode(
                    label,
                    owner,
                    duration,
                    secret,
                    resolver,
                    data,
                    reverseRecord,
                    ownerControlledFuses
                )
            );
    }

    function commit(bytes32) public pure override {
        // Commitment not required for free registration - function does nothing
    }

    function register(
        string calldata name,
        address owner,
        uint256 duration, // duration ignored
        bytes32 secret, // secret ignored
        address resolver,
        bytes[] calldata data,
        bool reverseRecord,
        uint16 ownerControlledFuses // ownerControlledFuses ignored
    ) public payable override {
        // Check data/resolver constraint first
        if (data.length > 0 && resolver == address(0)) {
            revert ResolverRequiredWhenDataSupplied();
        }
        
        // Check if wallet already owns a name
        if (hasRegisteredName[owner]) {
            revert WalletAlreadyOwnsName(owner);
        }
        
        // Validate name (length, characters, restrictions)
        validateName(name);
        
        // Convert name to lowercase for consistency
        string memory lowerName = _toLowerCase(name);
        
        // Basic availability check with lowercase name
        require(available(lowerName), "Name not available");
        
        bytes32 label = keccak256(bytes(lowerName));
        bytes32 node = keccak256(abi.encodePacked(STABLE_NODE, label));
        uint256 tokenId = uint256(label);
        
        // Register with BaseRegistrarImplementation (creates NFT and ENS node)
        base.register(tokenId, owner, 0);

        // Set resolver and address record if provided
        if (resolver != address(0)) {
            ens.setResolver(node, resolver);
            _setRecord(resolver, node, owner);
        }

        // Set reverse record if requested (use lowercase name)
        if (reverseRecord) {
            _setReverseRecord(lowerName, resolver, owner);
        }
        
        // Mark wallet as having registered a name
        hasRegisteredName[owner] = true;

        emit NameRegistered(
            lowerName, // Use lowercase name
            label,
            owner,
            0, // base cost
            0, // premium 
            0  // expires (permanent)
        );

        // Refund any stable coin sent (registration is free)
        if (msg.value > 0) {
            payable(msg.sender).transfer(msg.value);
        }
    }

    function renew(
        string calldata name,
        uint256 duration
    ) external payable override {
        revert("Names are permanent - renewal not supported");
    }

    function withdraw() public {
        payable(owner()).transfer(address(this).balance);
    }

    function supportsInterface(
        bytes4 interfaceID
    ) external pure returns (bool) {
        return
            interfaceID == type(IERC165).interfaceId ||
            interfaceID == type(IETHRegistrarController).interfaceId;
    }

    /* Internal functions */

    function _setRecord(
        address resolverAddress,
        bytes32 node,
        address addr
    ) internal {
        // Set ETH address record directly
        Resolver resolver = Resolver(resolverAddress);
        resolver.setAddr(node, addr);
    }

    function _setReverseRecord(
        string memory name,
        address resolver,
        address owner
    ) internal {
        reverseRegistrar.setNameForAddr(
            msg.sender,
            owner,
            resolver,
            string.concat(name, ".stable")
        );
    }
    
    function _initializeRestrictedNames() internal {
        // Common restricted names to prevent scams/impersonation
        string[20] memory restricted = [
            "stable", "admin", "root", "system", "owner",
            "binance", "tether", "usdt", "usdc", "ethereum",
            "bitcoin", "cosmos", "official", "support", "help",
            "service", "team", "foundation", "protocol", "network"
        ];
        
        for (uint i = 0; i < restricted.length; i++) {
            bytes32 nameHash = keccak256(bytes(restricted[i]));
            restrictedNames[nameHash] = true;
        }
    }
    
    // Admin functions for managing restricted names
    function addRestrictedName(string calldata name) external onlyOwner {
        bytes32 nameHash = keccak256(bytes(_toLowerCase(name)));
        restrictedNames[nameHash] = true;
    }
    
    function removeRestrictedName(string calldata name) external onlyOwner {
        bytes32 nameHash = keccak256(bytes(_toLowerCase(name)));
        restrictedNames[nameHash] = false;
    }
    
    function isRestricted(string calldata name) external view returns (bool) {
        bytes32 nameHash = keccak256(bytes(_toLowerCase(name)));
        return restrictedNames[nameHash];
    }
}
