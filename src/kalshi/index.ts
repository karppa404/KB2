import { Configuration, PortfolioApi } from 'kalshi-typescript';

// Configure the SDK
const config = new Configuration({
    apiKey: 'your-api-key-id',
    privateKeyPath: 'path/to/your/private-key.pem', // or use privateKeyPem
    basePath: 'https://external-api.kalshi.com/trade-api/v2'
});

// Create API instance
const portfolioApi = new PortfolioApi(config);

// Make API calls
const balance = await portfolioApi.getBalance();
console.log(`Balance: $${(balance.data.balance || 0) / 100}`);