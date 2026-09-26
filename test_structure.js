const chrome = require('chrome-remote-interface');

async function run() {
  let client;
  try {
    client = await chrome({ port: 9222 });
    const { Runtime } = client;
    await Runtime.enable();
    const result = await Runtime.evaluate({
      expression: `
        new Promise((resolve) => {
          chrome.runtime.sendMessage({
            type: "STRUCTURE_DOCUMENT_TEXT",
            text: "My name is John Doe. I am 30 years old and work as a software engineer at Google. My email is john.doe@example.com and phone is 555-1234.",
            consented: true
          }, (res) => resolve(res));
        })
      `,
      awaitPromise: true,
      returnByValue: true
    });
    console.log(JSON.stringify(result.result.value, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    if (client) await client.close();
  }
}
run();
