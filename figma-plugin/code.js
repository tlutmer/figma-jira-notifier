// This plugin places change log sticky notes below updated frames
figma.showUI(__html__, { width: 340, height: 420 });

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'apply-changes') {
    const { changes, runDate, jiraIssueKey } = msg;

    if (!changes || changes.length === 0) {
      figma.notify('No frame changes to apply.');
      return;
    }

    await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
    await figma.loadFontAsync({ family: 'Inter', style: 'Bold' });

    let appliedCount = 0;

    for (const change of changes) {
      const frameId = change.frameId;
      const frameName = change.frameName;
      let targetNode = frameId ? figma.getNodeById(frameId) : null;

      if (!targetNode && frameName) {
        // Fallback: search currentPage for frame by name
        targetNode = figma.currentPage.findOne(n => n.name === frameName && (n.type === 'FRAME' || n.type === 'SECTION'));
      }

      if (!targetNode) continue;

      // Group or find parent
      const parent = targetNode.parent || figma.currentPage;

      // Create a change note container frame
      const noteFrame = figma.createFrame();
      noteFrame.name = `Change Log [${runDate}]`;
      noteFrame.layoutMode = 'VERTICAL';
      noteFrame.primaryAxisSizingMode = 'AUTO';
      noteFrame.counterAxisSizingMode = 'FIXED';
      noteFrame.resize(Math.max(320, targetNode.width), 100);
      noteFrame.paddingTop = 14;
      noteFrame.paddingBottom = 14;
      noteFrame.paddingLeft = 16;
      noteFrame.paddingRight = 16;
      noteFrame.itemSpacing = 8;
      noteFrame.cornerRadius = 8;

      // Styling: Dark subtle banner or light callout
      noteFrame.fills = [{ type: 'SOLID', color: { r: 0.97, g: 0.98, b: 0.99 } }];
      noteFrame.strokes = [{ type: 'SOLID', color: { r: 0.23, g: 0.51, b: 0.83 } }];
      noteFrame.strokeWeight = 2;

      // Header Text: Date + Jira Key
      const headerText = figma.createText();
      headerText.characters = `📅 ${runDate} — Design Change Log (${jiraIssueKey || 'Jira'})`;
      headerText.fontName = { family: 'Inter', style: 'Bold' };
      headerText.fontSize = 13;
      headerText.fills = [{ type: 'SOLID', color: { r: 0.12, g: 0.14, b: 0.16 } }];
      noteFrame.appendChild(headerText);

      // Body text: updates
      for (const item of change.items) {
        const bodyText = figma.createText();
        bodyText.characters = `• ${item}`;
        bodyText.fontName = { family: 'Inter', style: 'Regular' };
        bodyText.fontSize = 12;
        bodyText.fills = [{ type: 'SOLID', color: { r: 0.3, g: 0.35, b: 0.4 } }];
        noteFrame.appendChild(bodyText);
      }

      // Position note directly below the frame
      parent.appendChild(noteFrame);
      noteFrame.x = targetNode.x;
      noteFrame.y = targetNode.y + targetNode.height + 24;

      appliedCount++;
    }

    figma.notify(`Created ${appliedCount} change log note(s) below updated screens!`);
  }
};
