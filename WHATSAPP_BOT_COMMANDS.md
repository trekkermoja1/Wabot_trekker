# WhatsApp Bot Management Commands

## Sudo User Configuration

**Sudo Number:** 254704897825

This number has exclusive access to bot management commands through WhatsApp.

## Available Commands

### 1. .approve - Approve a New Bot

Approve a bot from the "new" status and start it with a specified duration.

**Syntax:**
```
.approve <bot_id> <duration_months>
```

**Duration Options:** 1, 2, 3, 6, or 12 months

**Example:**
```
.approve 64ed962d 3
```

**Response:**
```
✅ Bot Approved!

Bot ID: 64ed962d
Duration: 3 month(s)
Port: 4002
Expires: 14/04/2026, 12:21:43

Bot is now running and moved to approved bots.
```

---

### 2. .newbots - List New Bots

View all bots awaiting approval.

**Syntax:**
```
.newbots
```

**Example Response:**
```
📋 New Bots (2)

1. My WhatsApp Bot
   ID: `abc12345`
   Phone: +1234567890
   Created: 14/01/2026, 09:15:30
   Server: server1

2. Customer Service Bot
   ID: `def67890`
   Phone: +9876543210
   Created: 14/01/2026, 10:20:15
   Server: server1

💡 To approve: .approve <bot_id> <duration>
Example: .approve abc12345 3
```

---

### 3. .expiredbots - List Expired Bots

View all bots that have expired and need renewal.

**Syntax:**
```
.expiredbots
```

**Example Response:**
```
📋 Expired Bots (1)

1. Sales Bot
   ID: `xyz98765`
   Phone: +1122334455
   Expired: 10/01/2026, 08:30:00
   Last Duration: 1 month(s)
   Server: server1

💡 These bots need renewal to restart.
```

---

## Command Workflow

### Typical Bot Lifecycle via WhatsApp

1. **Check New Bots**
   ```
   .newbots
   ```

2. **Approve a Bot**
   ```
   .approve abc12345 3
   ```
   (Approves bot "abc12345" for 3 months)

3. **Monitor Expiring Bots**
   ```
   .expiredbots
   ```

4. **Renewal** (done via web dashboard)
   - Expired bots must be renewed through the web interface
   - After renewal, they return to approved status

---

## Access Control

### Sudo Number Only
- Only **254704897825** can use these commands
- Other users will receive:
  ```
  ❌ This command is only available for sudo user (254704897825)
  ```

### How It Works
1. Bot checks sender's WhatsApp number
2. Compares with `settings.sudoNumber`
3. Allows or denies command execution

---

## Backend Integration

### API Endpoints Used

**Get New Bots:**
```
GET /api/instances?status=new
```

**Approve Bot:**
```
POST /api/instances/{bot_id}/approve
Body: { "duration_months": 3 }
```

**Get Expired Bots:**
```
GET /api/instances?status=expired
```

### Configuration

**File:** `/app/bot/settings.js`
```javascript
sudoNumber: '254704897825',
backendApiUrl: 'http://localhost:8001',
```

---

## Testing the Commands

### Prerequisites
1. WhatsApp bot must be connected and running
2. Use the sudo number (254704897825)
3. Backend API must be accessible

### Test Sequence

1. **Create a test bot** (via web dashboard or API)

2. **Send WhatsApp message:**
   ```
   .newbots
   ```

3. **You should see the new bot listed**

4. **Approve it:**
   ```
   .approve <bot_id_from_list> 1
   ```

5. **Check approved bots** (via web dashboard)

---

## Error Handling

### Invalid Bot ID
```
❌ Approval Failed

Instance not found
```

### Invalid Duration
```
❌ Invalid duration. Choose from: 1, 2, 3, 6, or 12 months
```

### Bot Not in "New" Status
```
❌ Approval Failed

Instance is not in 'new' status
```

### Backend Connection Error
```
❌ Error

Cannot reach backend API
```

---

## Command Implementation

### File Location
`/app/bot/commands/botmanagement.js`

### Dependencies
- axios (HTTP requests)
- settings.js (configuration)

### Integration
Commands are integrated in `/app/bot/main.js` within the switch statement for command handling.

---

## Important Notes

1. **Sudo Number Format**
   - Store as: `254704897825`
   - Bot converts to: `254704897825@s.whatsapp.net`

2. **Backend URL**
   - Default: `http://localhost:8001`
   - Must be accessible from bot process
   - Update in settings.js if different

3. **Duration Validation**
   - Only accepts: 1, 2, 3, 6, 12
   - Enforced on both bot and backend

4. **Status Flow**
   - NEW → (approve) → APPROVED → (expires) → EXPIRED
   - Commands only affect NEW status
   - EXPIRED bots need web dashboard renewal

---

## Troubleshooting

### Command Not Responding
1. Check bot is connected: Look for connected user in logs
2. Verify sudo number in settings.js
3. Check backend is running: `curl http://localhost:8001/api/health`

### "Not Available for Sudo User" Error
1. Verify sending from correct number (254704897825)
2. Check settings.js has correct sudoNumber
3. Restart bot if settings were changed

### Approval Fails
1. Check bot ID is correct
2. Verify bot is in "new" status
3. Check backend logs for errors

---

**Configuration Complete:** ✓  
**Sudo Number:** 254704897825  
**Commands:** .approve, .newbots, .expiredbots  
**Status:** Active
