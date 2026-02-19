const PQueue = require('p-queue').default;

const mediaQueue = new PQueue({ concurrency: 2 });

async function addToQueue(task) {
    return mediaQueue.add(task);
}

module.exports = { addToQueue };