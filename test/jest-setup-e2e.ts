import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env.test before running tests
config({ path: resolve(__dirname, '../.env.test') });
