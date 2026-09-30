/**
 * A scripted OpenAI-compatible endpoint, for exercising the agent without a
 * real provider. It answers with whatever tool call the conversation has not
 * made yet, then summarises. Development only; never deployed.
 */
import { createServer } from 'node:http';

const port = Number(process.argv[2] || 8788);

const plan = [
  { name: 'list_files', args: { path: '' }, say: 'Let me see what is in the workspace.' },
  { name: 'read_file', args: { path: 'greet.py' }, say: 'Now I will read the script.' },
  {
    name: 'write_file',
    args: {
      path: 'greet.py',
      content: 'import sys\n\n\ndef greet(name: str) -> str:\n    """Return a greeting for name."""\n    return f"Hello, {name}!"\n\n\nif __name__ == "__main__":\n    print(greet(sys.argv[1] if len(sys.argv) > 1 else "world"))\n',
    },
    say: 'I will add a docstring and let the name come from the command line.',
  },
];

createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let messages = [];
    try { messages = JSON.parse(body).messages || []; } catch { /* keep going */ }
    const used = messages.filter((m) => m.role === 'tool').length;
    const step = plan[used];

    const message = step
      ? {
          role: 'assistant',
          content: step.say,
          tool_calls: [{
            id: 'call_' + used,
            type: 'function',
            function: { name: step.name, arguments: JSON.stringify(step.args) },
          }],
        }
      : {
          role: 'assistant',
          content: 'I read the workspace, opened `greet.py`, and proposed a rewrite that adds a '
            + 'docstring, a type hint, and an argument from the command line. The change is '
            + 'waiting for your approval.',
        };

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'mock', object: 'chat.completion', model: 'mock-model',
      choices: [{ index: 0, message, finish_reason: step ? 'tool_calls' : 'stop' }],
    }));
  });
}).listen(port, '0.0.0.0', () => console.log('mock provider on ' + port));
