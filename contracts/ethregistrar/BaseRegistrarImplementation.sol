pragma solidity >=0.8.4;

import "../registry/ENS.sol";
import "./IBaseRegistrar.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
// import "@openzeppelin/contracts/access/Ownable.sol"; // Removed: DAO governance only

/**
 * @title BaseRegistrarImplementation
 * @dev Modified for Stable Name Service with specific constraints:
 * - No ownership changes after registration (immutable ownership)
 * - One domain per EOA restriction (One Name Per Wallet)
 * - No domain expiration (permanent registration) 
 * - Free registration (zero cost)
 * - Name length: 5-15 characters
 * - Unicode only, no spaces, case-insensitive
 * - Reserved names protection
 * - DAO governance only (no admin)
 */
contract BaseRegistrarImplementation is ERC721, IBaseRegistrar /* , Ownable */ {
    // A map of expiry times - DISABLED for non-expiring domains
    // mapping(uint256 => uint256) expiries;
    // The ENS registry
    ENS public ens;
    // The namehash of the TLD this registrar owns - changed from .eth to .stable
    bytes32 public constant STABLE_NODE = 0xbc67d859e38ff2c79747cbf55827e66700c058ff8a1b8990fb27e9c934ba3b6c;
    // A map of addresses that are authorised to register and renew names.
    mapping(address => bool) public controllers;
    
    // NEW: Stable Name Service specific mappings
    // Track one domain per account (One Name Per Wallet)
    mapping(address => bool) public hasRegistered;
    mapping(address => uint256) public accountToTokenId;
    mapping(uint256 => string) public tokenIdToName;
    
    // Domain name to token ID mapping (normalized lowercase)
    mapping(string => uint256) public nameToTokenId;
    
    // Reserved names mapping for preventing impersonation/scam
    mapping(string => bool) public reservedNames;
    // uint256 public constant GRACE_PERIOD = 90 days; // DISABLED - no expiration
    
    // NEW: Stable Name Service events
    event ReservedNameAdded(string indexed name);
    event ReservedNameRemoved(string indexed name);
    
    bytes4 private constant INTERFACE_META_ID =
        bytes4(keccak256("supportsInterface(bytes4)"));
    bytes4 private constant ERC721_ID =
        bytes4(
            keccak256("balanceOf(address)") ^
                keccak256("ownerOf(uint256)") ^
                keccak256("approve(address,uint256)") ^
                keccak256("getApproved(uint256)") ^
                keccak256("setApprovalForAll(address,bool)") ^
                keccak256("isApprovedForAll(address,address)") ^
                keccak256("transferFrom(address,address,uint256)") ^
                keccak256("safeTransferFrom(address,address,uint256)") ^
                keccak256("safeTransferFrom(address,address,uint256,bytes)")
        );
    bytes4 private constant RECLAIM_ID =
        bytes4(keccak256("reclaim(uint256,address)"));

    /// v2.1.3 version of _isApprovedOrOwner which calls ownerOf(tokenId) and takes grace period into consideration instead of ERC721.ownerOf(tokenId);
    /// https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v2.1.3/contracts/token/ERC721/ERC721.sol#L187
    /// @dev Returns whether the given spender can transfer a given token ID
    /// @param spender address of the spender to query
    /// @param tokenId uint256 ID of the token to be transferred
    /// @return bool whether the msg.sender is approved for the given token ID,
    ///              is an operator of the owner, or is the owner of the token
    function _isApprovedOrOwner(
        address spender,
        uint256 tokenId
    ) internal view override returns (bool) {
        address owner = ownerOf(tokenId);
        return (spender == owner ||
            getApproved(tokenId) == spender ||
            isApprovedForAll(owner, spender));
    }

    constructor(ENS _ens) ERC721("Stable Domains", "STABLE") {
        ens = _ens;
        // baseNode is now hardcoded as STABLE_NODE
        
        // Initialize common reserved names for Stable Name Service
        _addReservedName("stable");
        _addReservedName("binance");
        _addReservedName("tether");
        _addReservedName("usdt");
        _addReservedName("bitcoin");
        _addReservedName("ethereum");
        _addReservedName("admin");
        _addReservedName("root");
        _addReservedName("owner");
    }

    modifier live() {
        require(ens.owner(STABLE_NODE) == address(this));
        _;
    }

    modifier onlyController() {
        require(controllers[msg.sender], "BaseRegistrar: Caller is not a controller");
        _;
    }

    /// @dev Gets the owner of the specified token ID. Names never expire.
    /// @param tokenId uint256 ID of the token to query the owner of
    /// @return address currently marked as the owner of the given token ID
    function ownerOf(
        uint256 tokenId
    ) public view override(IERC721, ERC721) returns (address) {
        // No expiration check - domains are permanent
        return super.ownerOf(tokenId);
    }

    // Authorises a controller, who can register and renew domains.
    // NOTE: In production, this should be managed by DAO governance
    function addController(address controller) external override /* onlyOwner */ {
        // TODO: Replace with DAO governance mechanism
        controllers[controller] = true;
        emit ControllerAdded(controller);
    }

    // Revoke controller permission for an address.
    // NOTE: In production, this should be managed by DAO governance
    function removeController(address controller) external override /* onlyOwner */ {
        // TODO: Replace with DAO governance mechanism
        controllers[controller] = false;
        emit ControllerRemoved(controller);
    }

    // Set the resolver for the TLD this registrar manages.
    // NOTE: In production, this should be managed by DAO governance
    function setResolver(address resolver) external override /* onlyOwner */ {
        // TODO: Replace with DAO governance mechanism
        ens.setResolver(STABLE_NODE, resolver);
    }

    /**
     * @dev Add a reserved name (DAO governance only)
     * NOTE: In production, this should be managed by DAO governance
     */
    function addReservedName(string calldata name) external /* onlyDAO */ {
        // TODO: Replace with DAO governance mechanism
        string memory normalizedName = _normalizeName(name);
        _addReservedName(normalizedName);
    }

    /**
     * @dev Remove a reserved name (DAO governance only)
     * NOTE: In production, this should be managed by DAO governance
     */
    function removeReservedName(string calldata name) external /* onlyDAO */ {
        // TODO: Replace with DAO governance mechanism
        string memory normalizedName = _normalizeName(name);
        reservedNames[normalizedName] = false;
        emit ReservedNameRemoved(normalizedName);
    }

    // Returns the expiration timestamp of the specified id.
    function nameExpires(uint256 id) external view override returns (uint256) {
        // Always return max uint256 to indicate no expiration
        return type(uint256).max;
    }

    // Returns true iff the specified name is available for registration.
    function available(uint256 id) public view override returns (bool) {
        // Available only if not owned
        return !_exists(id);
    }

    /**
     * @dev Check if a name is available for registration (Stable Name Service)
     */
    function availableName(string calldata name) external view returns (bool) {
        string memory normalizedName = _normalizeName(name);
        return _validateName(normalizedName) && 
               !reservedNames[normalizedName] && 
               nameToTokenId[normalizedName] == 0;
    }

    /// @dev Register a name.
    /// @param id The token ID (keccak256 of the label).
    /// @param owner The address that should own the registration.
    /// @param duration Duration in seconds for the registration.
    function register(
        uint256 id,
        address owner,
        uint256 duration
    ) external override returns (uint256) {
        return _register(id, owner, duration, true);
    }

    /// @dev Register a name, without modifying the registry.
    /// @param id The token ID (keccak256 of the label).
    /// @param owner The address that should own the registration.
    /// @param duration Duration in seconds for the registration.
    function registerOnly(
        uint256 id,
        address owner,
        uint256 duration
    ) external returns (uint256) {
        return _register(id, owner, duration, false);
    }
    
    function registerWithSetup(
        uint256 id,
        address owner,
        address resolver
    ) external onlyController returns (uint256) {
        require(available(id));
        require(!hasRegistered[owner], "BaseRegistrar: One name per wallet limit");
        
        _mint(owner, id);
        
        // Update Stable Name Service mappings
        hasRegistered[owner] = true;
        accountToTokenId[owner] = id;
        
        // Set owner in ENS registry
        ens.setSubnodeOwner(STABLE_NODE, bytes32(id), owner);
        
        // Set resolver if provided
        if (resolver != address(0)) {
            bytes32 node = keccak256(abi.encodePacked(STABLE_NODE, bytes32(id)));
            ens.setResolver(node, resolver);
        }
        
        emit NameRegistered(id, owner, type(uint256).max);
        return type(uint256).max;
    }

    /**
     * @dev Register a domain name with string input (Stable Name Service)
     * Enforces all Stable Name Service policies
     */
    function registerName(
        uint256 id,
        address owner,
        string calldata name
    ) external onlyController returns (uint256) {
        // Normalize name to lowercase for consistency
        string memory normalizedName = _normalizeName(name);
        
        // Validate name according to policies
        require(_validateName(normalizedName), "BaseRegistrar: Invalid name format");
        require(!reservedNames[normalizedName], "BaseRegistrar: Name is reserved");
        require(available(id), "BaseRegistrar: Token already exists");
        require(!hasRegistered[owner], "BaseRegistrar: One name per wallet limit");
        require(nameToTokenId[normalizedName] == 0, "BaseRegistrar: Name already registered");

        // Create ENS subnode
        bytes32 label = keccak256(bytes(normalizedName));
        ens.setSubnodeOwner(STABLE_NODE, label, owner);

        // Mint NFT (immutable binding)
        _mint(owner, id);

        // Update mappings
        hasRegistered[owner] = true;
        accountToTokenId[owner] = id;
        tokenIdToName[id] = normalizedName;
        nameToTokenId[normalizedName] = id;

        emit NameRegistered(id, owner, type(uint256).max);
        return type(uint256).max;
    }

    function _register(
        uint256 id,
        address owner,
        uint256 /* duration */,
        bool updateRegistry
    ) internal live onlyController returns (uint256) {
        require(available(id), "BaseRegistrar: Name not available");
        require(!hasRegistered[owner], "BaseRegistrar: One name per wallet limit");
        // Duration parameter ignored - domains are permanent

        _mint(owner, id);
        
        // Update Stable Name Service mappings
        hasRegistered[owner] = true;
        accountToTokenId[owner] = id;
        
        if (updateRegistry) {
            ens.setSubnodeOwner(STABLE_NODE, bytes32(id), owner);
        }

        emit NameRegistered(id, owner, type(uint256).max);

        return type(uint256).max;
    }

    function renew(
        uint256 id,
        uint256 duration
    ) external override live onlyController returns (uint256) {
        // Renewal not needed - domains are permanent
        revert("BaseRegistrar: Renewal not needed for permanent domains");
    }

    /// @dev Reclaim ownership of a name in ENS, if you own it in the registrar.
    function reclaim(uint256 id, address owner) external override live {
        require(_isApprovedOrOwner(msg.sender, id));
        ens.setSubnodeOwner(STABLE_NODE, bytes32(id), owner);
    }

    function supportsInterface(
        bytes4 interfaceID
    ) public view override(ERC721, IERC165) returns (bool) {
        return
            interfaceID == INTERFACE_META_ID ||
            interfaceID == ERC721_ID ||
            interfaceID == RECLAIM_ID ||
            super.supportsInterface(interfaceID);
    }

    // Override transfers to prevent ownership changes (immutable ownership)
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId,
        uint256 batchSize
    ) internal override {
        // Allow minting (from == address(0)) but prevent all transfers
        require(from == address(0), "BaseRegistrar: Ownership transfer not allowed");
        super._beforeTokenTransfer(from, to, tokenId, batchSize);
    }

    /**
     * @dev Internal function to normalize name to lowercase
     */
    function _normalizeName(string memory name) internal pure returns (string memory) {
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

    /**
     * @dev Internal function to validate name format
     * Requirements: 5-15 characters, Unicode only, no spaces
     */
    function _validateName(string memory name) internal pure returns (bool) {
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
     * @dev Internal function to add reserved name
     */
    function _addReservedName(string memory name) internal {
        reservedNames[name] = true;
        emit ReservedNameAdded(name);
    }
}
