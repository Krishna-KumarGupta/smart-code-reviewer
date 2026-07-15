const MAX_DIFF_CHARS = 30000;

export class AIService {
  /**
   * Prepares and sanitizes payload for the LLM StateGraph review engine
   */
  static preparePayload(prDetails, repoName) {
    let sanitizedDiff = prDetails.diff;
    if (sanitizedDiff.length > MAX_DIFF_CHARS) {
      sanitizedDiff = sanitizedDiff.substring(0, MAX_DIFF_CHARS) + 
        `\n\n... [Diff truncated to first ${MAX_DIFF_CHARS} characters for token safety] ...`;
    }

    const fileListOutline = prDetails.files
      .map(f => `- ${f.filename} (+${f.additions}, -${f.deletions})`)
      .join('\n');

    const fileContext = `
Changed Files Summary:
${fileListOutline}

Scope of Changes:
- Total modified files: ${prDetails.files.length}
- Target Base Branch: ${prDetails.baseBranch}
- Source Head Branch: ${prDetails.headBranch}
    `.trim();

    return {
      pr_metadata: {
        pr_id: prDetails.id,
        pr_number: prDetails.number,
        pr_title: prDetails.title,
        pr_url: prDetails.url,
        pr_author: prDetails.author,
        repo_name: repoName,
        base_branch: prDetails.baseBranch,
        head_branch: prDetails.headBranch,
      },
      diff_content: sanitizedDiff,
      file_context: fileContext,
      retry_count: 0,
    };
  }

  /**
   * Invokes OpenRouter API to analyze the PR diff and return findings
   */
  static async analyzeDiff(payload) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error('Missing OPENROUTER_API_KEY environment variable.');
    }

    const model = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
    const referer = process.env.OPENROUTER_REFERER || 'http://localhost:5000';
    const title = process.env.OPENROUTER_TITLE || 'Smart Code Reviewer';

    const systemPrompt = `
You are a Senior AI Systems Architect and Lead Python Developer acting as a code reviewer.
Analyze the pull request diff thoroughly based on security, architecture, performance, and clean code.

You must output a strictly structured JSON response matching the following schema. Do not output any prose, markdown wrapping, or code block markers.

Schema:
{
  "decision": "Approved" | "Changes Requested",
  "summary": "High-level overview summary of the pull request",
  "findings": [
    {
      "category": "security" | "performance" | "maintainability" | "style",
      "severity": "Critical" | "High" | "Medium" | "Low",
      "file_path": "relative/path/to/file",
      "line_number": 42,
      "description": "Explanation of the finding",
      "suggested_fix": "Code snippet or explicit instruction on how to fix"
    }
  ]
}
`.trim();

    const userPrompt = `
PR Title: ${payload.pr_metadata.pr_title}
Repository Context:
${payload.file_context}

Pull Request Diff:
${payload.diff_content}
`.trim();

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': referer,
        'X-Title': title,
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API request failed: Status ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from OpenRouter API.');
    }

    return JSON.parse(content.trim());
  }
}
