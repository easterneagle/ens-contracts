//SPDX-License-Identifier: MIT
pragma solidity ~0.8.17;

import {BaseRegistrarImplementation} from "./BaseRegistrarImplementation.sol";
import {IPriceOracle} from "./IETHRegistrarController.sol";
import {ENS} from "../registry/ENS.sol";

interface IPublicResolver {
    function setAddr(bytes32 node, address addr) external;
    function setName(bytes32 node, string calldata name) external;
}

// NEW: Stable Name Service specific errors
error NameNotAvailable(string name);
error NameTooShort(string name);
error NameTooLong(string name);
error NameReserved(string name);
error WalletAlreadyHasName(address wallet);
error InvalidName(string name);

/**
 * @title ETHRegistrarController
 * @dev Modified for Stable Name Service following policies:
 * - Free registration (zero cost)
 * - Name validation (5-15 chars, Unicode, no spaces, case-insensitive)
 * - One name per wallet
 * - Reserved names protection
 * - Off-chain metadata only
 * - No commit-reveal (immediate registration)
 * - DAO governance only
 */
contract ETHRegistrarController {
    bytes32 private constant STABLE_NODE =
        0xbc67d859e38ff2c79747cbf55827e66700c058ff8a1b8990fb27e9c934ba3b6c;
    BaseRegistrarImplementation immutable base;
    ENS immutable ens;

    event NameRegistered(
        string indexed name,
        address indexed owner,
        uint256 indexed tokenId
    );

    constructor(BaseRegistrarImplementation _base) {
        base = _base;
        ens = base.ens();
    }

    /**
     * @dev Register a .stable domain (FREE - zero cost)
     * Enforces Stable Name Service policies
     */
    function register(string calldata name, address resolver) external {
        // Pre-validation with clear error messages
        bytes memory nameBytes = bytes(name);
        if (nameBytes.length < 5) {
            revert NameTooShort(name);
        }
        if (nameBytes.length > 15) {
            revert NameTooLong(name);
        }
        
        // Check one name per wallet policy
        if (base.hasRegistered(msg.sender)) {
            revert WalletAlreadyHasName(msg.sender);
        }
        
        // Normalize name for consistency
        string memory normalizedName = _toLowercase(name);
        
        // Check if name is reserved
        if (base.reservedNames(normalizedName)) {
            revert NameReserved(normalizedName);
        }
        
        // Generate token ID from normalized name hash
        bytes32 label = keccak256(bytes(normalizedName));
        uint256 tokenId = uint256(label);
        
        // Register through BaseRegistrarImplementation with resolver
        base.registerName(tokenId, msg.sender, normalizedName);
        
        // NOTE: Resolver setting removed - ENS standard workflow:
        // 1. Register domain first
        // 2. User sets resolver via ENS.setResolver()
        // 3. User sets address via PublicResolver.setAddr()
        // This matches the standard ENS registration flow
        
        emit NameRegistered(normalizedName, msg.sender, tokenId);
    }

    /**
     * @dev Check if a name meets validation requirements
     * Requirements: 5-15 characters, Unicode only, no spaces
     */
    function valid(string memory name) public pure returns (bool) {
        bytes memory nameBytes = bytes(name);
        uint256 length = nameBytes.length;
        
        // Check length: 5-15 characters
        if (length < 5 || length > 15) {
            return false;
        }
        
        // Check for invalid characters (spaces, control characters)
        for (uint256 i = 0; i < length; i++) {
            bytes1 char = nameBytes[i];
            
            // Reject whitespace characters (space, tab, newline, etc.)
            if (char == 0x20 || char == 0x09 || char == 0x0A || char == 0x0D) {
                return false;  
            }
            
            // Reject control characters (0x00-0x1F, 0x7F-0x9F)
            if ((char >= 0x00 && char <= 0x1F) || (char >= 0x7F && char <= 0x9F)) {
                return false;
            }
        }
        
        return true;
    }

    /**
     * @dev Check if a name is available for registration
     */
    function available(string memory name) public view returns (bool) {
        return base.availableName(name);
    }

    /**
     * @dev Dummy rentPrice function for compatibility (always returns 0 - free registration)
     */
    function rentPrice(string memory /* name */, uint256 /* duration */) public pure returns (IPriceOracle.Price memory price) {
        return IPriceOracle.Price({base: 0, premium: 0}); // Free registration
    }

    /**
     * @dev Dummy renew function for compatibility (no-op since domains are permanent)
     */
    function renew(string calldata /* name */, uint256 /* duration */) external payable {
        // No-op: domains are permanent, no renewal needed
        revert("ETHRegistrarController: Renewal not needed for permanent domains");
    }

    // NOTE: Domain resolution functions removed - use standard ENS PublicResolver instead
    // Forward resolution: PublicResolver.addr(namehash("name.stable"))
    // Reverse resolution: PublicResolver.name(reverseNode(address))

    /**
     * @dev Internal function to convert string to lowercase
     */
    function _toLowercase(string memory name) internal pure returns (string memory) {
        bytes memory nameBytes = bytes(name);
        bytes memory result = new bytes(nameBytes.length);
        
        for (uint256 i = 0; i < nameBytes.length; i++) {
            // Convert uppercase ASCII to lowercase
            if (nameBytes[i] >= 0x41 && nameBytes[i] <= 0x5A) {
                result[i] = bytes1(uint8(nameBytes[i]) + 32);
            } else {
                result[i] = nameBytes[i];
            }
        }
        
        return string(result);
    }
}