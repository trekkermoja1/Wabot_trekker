const nodecallspython = require("node-calls-python");
const py = nodecallspython.interpreter;

async function testBridge() {
    console.log("🌉 Testing Node-to-Python bridge...");
    try {
        // Example: Call a simple python command or script
        // In a real scenario, you'd import a specific python module
        const result = await py.run("print('Hello from Python via Node Bridge!')");
        console.log("✅ Bridge is working well.");
    } catch (error) {
        console.error("❌ Bridge error:", error);
    }
}

if (require.main === module) {
    testBridge();
}

module.exports = { testBridge };
