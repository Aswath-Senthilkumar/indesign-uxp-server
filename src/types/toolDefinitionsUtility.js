/**
 * Utility tool definitions for InDesign MCP Server
 * Utility functions and custom execution capabilities
 */

export const utilityToolDefinitions = [
    // =================== UTILITY TOOLS ===================
    // SAFETY: execute_indesign_code is disabled — see pre-stage-2-prompt.md Block 2.
    // The tool definition is removed from this array so the MCP server does not advertise
    // it to clients. Re-enabling requires an explicit security review.
    {
        name: 'view_document',
        description: 'View document information and current state',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'get_session_info',
        description: 'Get current session information including page dimensions and active document',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'clear_session',
        description: 'Clear all session data including page dimensions and document information',
        inputSchema: { type: 'object', properties: {} },
    },
]; 