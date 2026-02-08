const API_URL = 'http://localhost:5000';

const runTest = async () => {
    try {
        console.log('1. Creating a test user...');
        const userId = `test_user_delete_${Date.now()}`;
        const newUser = {
            userId: userId,
            phoneNumber: '+919999999999',
            name: 'Test Delete User',
            email: 'test@delete.com',
            notificationPreferences: {
                pushEnabled: true,
                emailEnabled: true,
                smsEnabled: false
            },
            acceptedPolicy: true,
            policyAcceptedAt: new Date(),
            emergencyContact: '9999988888'
        };

        const createRes = await fetch(`${API_URL}/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newUser)
        });
        const createdUser = await createRes.json();
        console.log('User created:', createdUser.userId);

        console.log('2. Fetching user to get full object...');
        const userRes = await fetch(`${API_URL}/users?phoneNumber=${encodeURIComponent(newUser.phoneNumber)}&_embed=vehicles`);
        const userData = await userRes.json();
        const user = userData[0];
        console.log('User fetched:', user.userId);

        console.log('3. Archiving user (simulating client logic)...');
        const archiveRes = await fetch(`${API_URL}/deletedUsers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...user, deletedAt: new Date() })
        });

        if (!archiveRes.ok) {
            const err = await archiveRes.text();
            throw new Error(`Failed to archive user: ${err}`);
        }
        console.log('User archived successfully.');

        console.log('4. Deleting user from active collection...');
        const deleteRes = await fetch(`${API_URL}/users/${user.userId}`, {
            method: 'DELETE'
        });

        if (!deleteRes.ok) {
            const err = await deleteRes.text();
            throw new Error(`Failed to delete user: ${err}`);
        }
        console.log('User deleted successfully.');

        console.log('Test PASSED: existing delete flow works via API.');

    } catch (error) {
        console.error('Test FAILED:', error.message);
    }
};

runTest();
