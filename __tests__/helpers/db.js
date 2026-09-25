const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod;

const connect = async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    // Unique indexes (otp single-use jti, phone uniqueness) are load-bearing in
    // these tests — wait for them to build.
    await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
};

const disconnect = async () => {
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
};

const clear = async () => {
    const collections = await mongoose.connection.db.collections();
    await Promise.all(collections.map((c) => c.deleteMany({})));
};

module.exports = { connect, disconnect, clear };
