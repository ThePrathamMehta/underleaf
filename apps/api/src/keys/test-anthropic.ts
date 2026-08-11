import Anthropic from '@anthropic-ai/sdk';

console.log(process.env.ANTHROPIC_API_KEY);

const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
});

async function testKey(): Promise<void> {
    try {
        const response = await client.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 100,
            messages: [{ role: 'user', content: 'Say hello in one sentence.' }],
        });

        const textBlock = response.content.find(
            (block) => block.type === 'text'
        );

        if (textBlock && textBlock.type === 'text') {
            console.log('✅ API key is working!');
            console.log(textBlock.text);
        } else {
            console.log('⚠️ No text content in response:', response.content);
        }
    } catch (err) {
        if (err instanceof Error) {
            console.log('❌ Error:', err.message);
        } else {
            console.log('❌ Unknown error:', err);
        }
    }
}

testKey();