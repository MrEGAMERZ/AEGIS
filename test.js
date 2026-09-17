const rawReply = `Here is the code:
\`\`\`json
{"action":"write_code","code":"#include <stdio.h>\nvoid merge() {
    printf(\"hello\");
}"}
\`\`\`
`;
const fenceMatch = rawReply.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
console.log(fenceMatch[1]);
