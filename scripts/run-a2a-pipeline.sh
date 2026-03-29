#!/bin/bash
# A2A Feature Pipeline: Product → Research → Design
# Runs 3 Claude Code agents sequentially, each building on previous output
# Progress tracked in scripts/qa-reports/pipeline-progress.md

set -e
cd "$(dirname "$0")/.."

REPORTS="scripts/qa-reports"
PROGRESS="$REPORTS/pipeline-progress.md"
mkdir -p "$REPORTS"

log() {
  echo "$(date '+%H:%M:%S') | $1" | tee -a "$PROGRESS"
}

echo "# A2A Pipeline Progress" > "$PROGRESS"
echo "Started: $(date)" >> "$PROGRESS"
echo "" >> "$PROGRESS"

# Step 1: Product Thinker
log "🟡 Step 1/3: Product Thinker — STARTED"
claude --print -p "$(cat scripts/a2a-product-think.md)" --allowedTools 'Read,Glob,Grep,Write,Bash(read-only)' 2>&1 | tail -20 >> "$REPORTS/product-thinker-log.txt"
if [ -f "$REPORTS/a2a-product-vision.md" ]; then
  log "✅ Step 1/3: Product Thinker — DONE (see a2a-product-vision.md)"
else
  log "⚠️ Step 1/3: Product Thinker — finished but no output file"
fi

# Step 2: Tech Researcher
log "🟡 Step 2/3: Tech Researcher — STARTED"
claude --print -p "$(cat scripts/a2a-tech-research.md)" --allowedTools 'Read,Glob,Grep,Write,Bash(read-only)' 2>&1 | tail -20 >> "$REPORTS/tech-researcher-log.txt"
if [ -f "$REPORTS/a2a-tech-research.md" ]; then
  log "✅ Step 2/3: Tech Researcher — DONE (see a2a-tech-research.md)"
else
  log "⚠️ Step 2/3: Tech Researcher — finished but no output file"
fi

# Step 3: Designer (this one CAN write code)
log "🟡 Step 3/3: Designer — STARTED"
claude --print -p "$(cat scripts/a2a-design.md)" --allowedTools 'Read,Glob,Grep,Write,Edit,Bash' 2>&1 | tail -20 >> "$REPORTS/designer-log.txt"
log "✅ Step 3/3: Designer — DONE"

echo "" >> "$PROGRESS"
log "🏁 Pipeline COMPLETE at $(date)"
echo "" >> "$PROGRESS"
echo "## Output Files" >> "$PROGRESS"
echo "- Product Vision: $REPORTS/a2a-product-vision.md" >> "$PROGRESS"
echo "- Tech Research: $REPORTS/a2a-tech-research.md" >> "$PROGRESS"
echo "- Design Spec: $REPORTS/a2a-design-spec.md" >> "$PROGRESS"
echo "- Code changes: check git diff" >> "$PROGRESS"
