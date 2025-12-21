import mongoose, { Connection } from 'mongoose';

const MONGODB_URI = process.env.MONGO_URI;
const MONGODB_DB = process.env.MONGO_DB;

if (!MONGODB_URI) {
  throw new Error('Please define the MONGO_URI environment variable inside .env.local');
}

if (!MONGODB_DB) {
  throw new Error('Please define the MONGO_DB environment variable inside .env.local');
}

/**
 * Global is used here to maintain a cached connection across hot reloads
 * in development. This prevents connections growing exponentially
 * during API Route usage.
 */
let cached: { conn: Connection | null; promise: Promise<Connection> | null } = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectDB() {
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
    };

    // High-performance connection pool configuration for Discord-scale traffic
    const maxPoolSize = parseInt(process.env.MONGODB_MAX_POOL_SIZE || '50', 10);
    const minPoolSize = parseInt(process.env.MONGODB_MIN_POOL_SIZE || '5', 10);
    const readPreference = (process.env.MONGODB_READ_PREFERENCE || 'primary') as 'primary' | 'secondary' | 'secondaryPreferred';

    cached.promise = mongoose.connect(MONGODB_URI as string, {
      dbName: MONGODB_DB,
      maxPoolSize,
      minPoolSize,
      readPreference,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
      ...opts,
    }).then((mongoose) => {
      console.log('✅ Connected to MongoDB');
      console.log(`   Pool: ${minPoolSize}-${maxPoolSize} connections, Read: ${readPreference}`);
      return mongoose.connection;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }

  return cached.conn;
}

export default connectDB;

