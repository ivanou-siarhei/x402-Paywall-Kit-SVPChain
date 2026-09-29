require('@nomicfoundation/hardhat-ethers');
require('@nomicfoundation/hardhat-chai-matchers');

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: '0.8.24',
    settings: { evmVersion: 'cancun' },
  },
  networks: {
    svpTestnet: {
      url: process.env.SVP_RPC || 'https://svp-dataseed1-testnet.svpchain.org',
      chainId: 2517,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
};
