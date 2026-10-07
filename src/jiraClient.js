'use strict';

const axios = require('axios');

// ---------------------------------------------------------------------------
// ADF helpers
// ---------------------------------------------------------------------------

function adfText(text, bold = false) {
  const node = { type: 'text', text };
  if (bold) node.marks = [{ type: 'strong' }];
  return node;
}

function adfParagraph(...inlineNodes) {
  return { type: 'paragraph', content: inlineNodes };
}

function adfBulletList(items) {
  return {
    type: 'bulletList',
    content: items.map(item => ({
      type: 'listItem',
      content: [adfParagraph(...(Array.isArray(item) ? item : [adfText(item)]))]
    }))
  };
}

function adfHeading(level, text) {
  return { type: 'heading', attrs: { level }, content: [adfText(text)] };
}

function adfMention(user) {
  if (typeof user === 'string') {
    return {
      type: 'mention',
      attrs: { id: user, text: `@${user.split('@')[0]}` }
    };
  }
  const id = user.jiraAccountId || user.email || user.displayName || '';
  const text = user.displayName ? `@${user.displayName}` : (user.email ? `@${user.email.split('@')[0]}` : `@${id}`);
  return {
    type: 'mention',
    attrs: { id, text }
  };
}

function adfRule() {
  return { type: 'rule' };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Human-readable label for a Figma node type. */
function typeLabel(type) {
  const map = {
    FRAME: 'Frame', GROUP: 'Group', COMPONENT: 'Component',
    COMPONENT_SET: 'Component set', INSTANCE: 'Instance',
    TEXT: 'Text', RECTANGLE: 'Rectangle', ELLIPSE: 'Ellipse',
    VECTOR: 'Vector', BOOLEAN_OPERATION: 'Boolean op', SECTION: 'Section'
  };
  return map[type] || type;
}

/**
 * Detects "sweeping" changes — change descriptions shared by >= threshold nodes
 * across the whole page. Returns { sweepingDescs, restEntries }.
 */
function partitionSweeping(entries, threshold = 3) {
  const changeCount = new Map();
  for (const entry of entries) {
    for (const c of (entry.changes || [])) {
      changeCount.set(c, (changeCount.get(c) || 0) + 1);
    }
  }
  const sweepingDescs = new Set(
    [...changeCount.entries()].filter(([, n]) => n >= threshold).map(([d]) => d)
  );

  const restEntries = entries.map(entry => ({
    ...entry,
    changes: (entry.changes || []).filter(c => !sweepingDescs.has(c))
  })).filter(e => e.changes.length > 0);

  return { sweepingDescs, restEntries };
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

/**
 * Builds the bullet rows for a set of added nodes:
 *   • [TypeLabel] Name
 */
function addedBullets(nodes) {
  return [...new Map(nodes.map(n => [n.id, n])).values()]
    .map(n => [adfText(`${typeLabel(n.type)}: ${n.name}`)]);
}

/**
 * Builds the bullet rows for a set of removed nodes.
 */
function removedBullets(nodes) {
  return [...new Map(nodes.map(n => [n.id, n])).values()]
    .map(n => [adfText(`${typeLabel(n.type)}: ${n.name}`)]);
}

/**
 * Builds the bullet rows for a set of updated nodes:
 *   • [TypeLabel] Name — change description
 */
function updatedBullets(nodes) {
  const rows = [];
  for (const node of nodes) {
    for (const change of (node.changes || [])) {
      rows.push([adfText(`${typeLabel(node.type)}: ${node.name} — ${change}`)]);
    }
  }
  return rows;
}

/**
 * Builds one "Screen: [frame]" block.
 */
function buildScreenBlock(frameName, addedNodes, removedNodes, updatedNodes) {
  const content = [];
  content.push(adfParagraph(adfText(`Screen: ${frameName}`, true)));

  const bullets = [];
  if (addedNodes.length > 0) {
    bullets.push([adfText('Added', true)], ...addedBullets(addedNodes));
  }
  if (removedNodes.length > 0) {
    bullets.push([adfText('Removed', true)], ...removedBullets(removedNodes));
  }
  if (updatedNodes.length > 0) {
    bullets.push([adfText('Updated', true)], ...updatedBullets(updatedNodes));
  }
  if (bullets.length > 0) content.push(adfBulletList(bullets));

  return content;
}

function formatCommentBullet(comment) {
  const author = (comment.user && (comment.user.handle || comment.user.name)) || 'Unknown user';
  const message = comment.message || '(no message)';
  return [
    adfText(`${author}: `, true),
    adfText(message)
  ];
}

/**
 * Builds the Comments section (New, Completed/Resolved, and Currently Open comments).
 *
 * @param {object|Array} commentsDiff  { newComments, resolvedComments, openComments } or array
 * @returns {Array} ADF node array
 */
function buildCommentsSection(commentsDiff) {
  if (!commentsDiff) return [];

  const newComments = Array.isArray(commentsDiff)
    ? commentsDiff
    : (commentsDiff.newComments || []);
  const resolvedComments = Array.isArray(commentsDiff)
    ? []
    : (commentsDiff.resolvedComments || []);
  const openComments = Array.isArray(commentsDiff)
    ? []
    : (commentsDiff.openComments || []);

  if (newComments.length === 0 && resolvedComments.length === 0 && openComments.length === 0) {
    return [];
  }

  const content = [adfHeading(3, 'Comments')];

  if (newComments.length > 0) {
    content.push(adfParagraph(adfText('New comments', true)));
    content.push(adfBulletList(newComments.map(formatCommentBullet)));
  }

  if (resolvedComments.length > 0) {
    content.push(adfParagraph(adfText('Completed comments', true)));
    content.push(adfBulletList(resolvedComments.map(formatCommentBullet)));
  }

  if (openComments.length > 0) {
    content.push(adfParagraph(adfText('Open comments', true)));
    content.push(adfBulletList(openComments.map(formatCommentBullet)));
  }

  content.push(adfRule());
  return content;
}

/**
 * Builds the full page → sweeping → screen-by-screen changelog section.
 */
function buildPageSections(added, removed, updated) {
  const allPages = new Set([
    ...added.map(n => n.pageName || 'Unknown page'),
    ...removed.map(n => n.pageName || 'Unknown page'),
    ...updated.map(n => n.pageName || 'Unknown page'),
  ]);

  const content = [];

  for (const page of allPages) {
    const pageAdded   = added.filter(n => (n.pageName || 'Unknown page') === page);
    const pageRemoved = removed.filter(n => (n.pageName || 'Unknown page') === page);
    const pageUpdated = updated.filter(n => (n.pageName || 'Unknown page') === page);

    content.push(adfHeading(3, page));

    // --- Sweeping changes ---
    const { sweepingDescs, restEntries: localUpdated } = partitionSweeping(pageUpdated);

    if (sweepingDescs.size > 0 || pageAdded.length > 0 || pageRemoved.length > 0) {
      const noFrameAdded   = pageAdded.filter(n => !n.frameName);
      const noFrameRemoved = pageRemoved.filter(n => !n.frameName);

      const sweepingBullets = [];
      if (noFrameAdded.length > 0) {
        sweepingBullets.push([adfText('Added', true)], ...addedBullets(noFrameAdded));
      }
      if (noFrameRemoved.length > 0) {
        sweepingBullets.push([adfText('Removed', true)], ...removedBullets(noFrameRemoved));
      }
      if (sweepingDescs.size > 0) {
        const sweepNodes = pageUpdated.filter(e =>
          (e.changes || []).some(c => sweepingDescs.has(c))
        ).map(e => ({ ...e, changes: (e.changes || []).filter(c => sweepingDescs.has(c)) }));
        sweepingBullets.push([adfText('Updated', true)], ...updatedBullets(sweepNodes));
      }

      if (sweepingBullets.length > 0) {
        content.push(adfParagraph(adfText('Sweeping changes', true)));
        content.push(adfBulletList(sweepingBullets));
      }
    }

    // --- Per-screen (frame) breakdown ---
    const frameNames = new Set([
      ...pageAdded.filter(n => n.frameName).map(n => n.frameName),
      ...pageRemoved.filter(n => n.frameName).map(n => n.frameName),
      ...localUpdated.filter(n => n.frameName).map(n => n.frameName),
    ]);

    for (const frame of frameNames) {
      const frameAdded   = pageAdded.filter(n => n.frameName === frame);
      const frameRemoved = pageRemoved.filter(n => n.frameName === frame);
      const frameUpdated = localUpdated.filter(n => n.frameName === frame);
      content.push(...buildScreenBlock(frame, frameAdded, frameRemoved, frameUpdated));
    }

    content.push(adfRule());
  }

  return content;
}

// ---------------------------------------------------------------------------
// Main ADF builder
// ---------------------------------------------------------------------------

/**
 * Builds the full ADF comment document for a diff result.
 *
 * @param {object}  diffResult        Output of differ.diffTrees()
 * @param {string}  figmaFileName
 * @param {string}  figmaUrl
 * @param {string}  runAt             ISO timestamp string
 * @param {Array}   mentionedUsers    Array of { displayName, jiraAccountId }
 * @param {string|null} snapshotDate  ISO timestamp of the baseline snapshot, or null
 * @returns {object} ADF document
 */
/**
 * Splits an array of body content ADF nodes into chunks such that the serialized
 * JSON string of each document stays well under Jira's 32,768 character limit.
 *
 * @param {Array} headerNodes
 * @param {Array} bodyNodes
 * @param {Array} footerNodes
 * @param {number} [maxCharsPerDoc=24000]
 * @returns {Array<object>} Array of valid ADF documents
 */
function chunkAdfDocument(headerNodes, bodyNodes, footerNodes, maxCharsPerDoc = 24000) {
  if (bodyNodes.length === 0) {
    return [{
      version: 1,
      type: 'doc',
      content: [...headerNodes, ...footerNodes]
    }];
  }

  const chunks = [];
  let currentBody = [];

  function calcDocSize(body) {
    const doc = {
      version: 1,
      type: 'doc',
      content: [...headerNodes, ...body, ...footerNodes]
    };
    return JSON.stringify(doc).length;
  }

  for (const node of bodyNodes) {
    const testBody = [...currentBody, node];
    if (currentBody.length > 0 && calcDocSize(testBody) > maxCharsPerDoc) {
      chunks.push(currentBody);
      currentBody = [node];
    } else {
      currentBody.push(node);
    }
  }

  if (currentBody.length > 0) {
    chunks.push(currentBody);
  }

  const totalParts = chunks.length;
  if (totalParts <= 1) {
    return [{
      version: 1,
      type: 'doc',
      content: [...headerNodes, ...(chunks[0] || []), ...footerNodes]
    }];
  }

  return chunks.map((chunkNodes, index) => {
    const partNum = index + 1;
    // Prefix header with Part indicator
    const partHeaderNodes = headerNodes.map((hNode, hIdx) => {
      if (hIdx === 0 && hNode.type === 'paragraph' && Array.isArray(hNode.content)) {
        return {
          ...hNode,
          content: [
            ...hNode.content,
            adfText(` (Part ${partNum} of ${totalParts})`, true)
          ]
        };
      }
      return hNode;
    });

    return {
      version: 1,
      type: 'doc',
      content: [
        ...partHeaderNodes,
        ...chunkNodes,
        ...(partNum === totalParts ? footerNodes : [])
      ]
    };
  });
}

/**
 * Builds ADF comment document(s) for a diff result, automatically chunking
 * into multiple documents if content exceeds Jira's size limit.
 *
 * @param {object}  diffResult        Output of differ.diffTrees()
 * @param {string}  figmaFileName
 * @param {string}  figmaUrl
 * @param {string}  runAt             ISO timestamp string
 * @param {Array}   mentionedUsers    Array of { displayName, jiraAccountId }
 * @param {string|null} snapshotDate  ISO timestamp of the baseline snapshot, or null
 * @returns {object} Single ADF document for backward compatibility
 */
function buildCommentAdf(diffResult, figmaFileName, figmaUrl, runAt, mentionedUsers, snapshotDate) {
  const docs = buildCommentAdfList(diffResult, figmaFileName, figmaUrl, runAt, mentionedUsers, snapshotDate);
  return docs[0];
}

/**
 * Builds a list of ADF comment documents (1 or more if chunked).
 */
function buildCommentAdfList(diffResult, figmaFileName, figmaUrl, runAt, mentionedUsers, snapshotDate) {
  const { added, removed, updated, commentsDiff, comments = [], totalChanges, pages } = diffResult;
  const pagesLabel = pages.length > 0 ? pages.join(', ') : 'Unknown';

  const headerContent = [adfText('Design Changelog — ', false), adfText(`${totalChanges} Changes`, true)];

  const mentionNodes = mentionedUsers.flatMap(u => [
    adfMention(u),
    adfText(' ')
  ]);

  // File row: filename as a clickable link when a URL is available
  const fileNameNode = figmaUrl
    ? { type: 'text', text: figmaFileName, marks: [{ type: 'link', attrs: { href: figmaUrl } }] }
    : adfText(figmaFileName);
  const fileRowNodes = [adfText('File: ', true), fileNameNode];

  const headerNodes = [
    adfParagraph(...headerContent),
    adfParagraph(...fileRowNodes),
    adfParagraph(adfText('Pages: ', true), adfText(pagesLabel)),
  ];

  if (!snapshotDate) {
    headerNodes.push(adfParagraph(adfText('No previous snapshot found. This is the first run — baseline saved, no diff to report.')));
  }

  headerNodes.push(adfRule());

  const bodyNodes = [];
  const activeCommentsDiff = commentsDiff || (comments.length > 0 ? { newComments: comments } : null);
  if (activeCommentsDiff) {
    bodyNodes.push(...buildCommentsSection(activeCommentsDiff));
  }

  if (added.length > 0 || removed.length > 0 || updated.length > 0) {
    bodyNodes.push(...buildPageSections(added, removed, updated));
  }

  const footerNodes = [];
  if (mentionNodes.length > 0) {
    footerNodes.push(adfRule());
    footerNodes.push(adfParagraph(adfText('Notifying: ', true), ...mentionNodes));
  }

  return chunkAdfDocument(headerNodes, bodyNodes, footerNodes);
}

// ---------------------------------------------------------------------------
// Jira API call
// ---------------------------------------------------------------------------

/**
 * Posts an ADF comment to a Jira issue.
 *
 * @param {string} jiraBaseUrl  e.g. "https://your-org.atlassian.net"
 * @param {string} email        Jira account email
 * @param {string} apiToken     Jira API token
 * @param {string} issueKey     e.g. "PROJ-123"
 * @param {object} commentAdf   ADF document object
 * @returns {Promise<void>}
 */
async function postComment(jiraBaseUrl, email, apiToken, issueKey, commentAdf) {
  const url = `${jiraBaseUrl}/rest/api/3/issue/${issueKey}/comment`;
  const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
  const adfList = Array.isArray(commentAdf) ? commentAdf : [commentAdf];

  for (const adf of adfList) {
    try {
      await axios.post(
        url,
        { body: adf },
        {
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          }
        }
      );
    } catch (err) {
      const status = err.response ? err.response.status : 'network error';
      const detail = err.response ? JSON.stringify(err.response.data) : err.message;
      throw new Error(`Jira postComment failed for issue "${issueKey}" — ${status}: ${detail}`);
    }
  }
}

/**
 * Fetches watchers for a Jira issue.
 *
 * @param {string} jiraBaseUrl  e.g. "https://your-org.atlassian.net"
 * @param {string} email        Jira account email
 * @param {string} apiToken     Jira API token
 * @param {string} issueKey     e.g. "PROJ-123"
 * @returns {Promise<Array<{accountId: string, displayName: string, email: string}>>}
 */
async function fetchWatchers(jiraBaseUrl, email, apiToken, issueKey) {
  const url = `${jiraBaseUrl.replace(/\/$/, '')}/rest/api/3/issue/${issueKey}/watchers`;
  const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');

  try {
    const res = await axios.get(url, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json'
      }
    });
    const watchers = (res.data && res.data.watchers) || [];
    return watchers.map(w => ({
      accountId: w.accountId,
      displayName: w.displayName,
      email: w.emailAddress || (w.displayName ? `${w.displayName.toLowerCase().replace(/\s+/g, '.')}@example.com` : w.accountId)
    }));
  } catch (err) {
    const status = err.response ? err.response.status : 'network error';
    const detail = err.response ? JSON.stringify(err.response.data) : err.message;
    throw new Error(`Jira fetchWatchers failed for issue "${issueKey}" — ${status}: ${detail}`);
  }
}

module.exports = { postComment, buildCommentAdf, buildCommentAdfList, chunkAdfDocument, fetchWatchers, buildCommentsSection };
