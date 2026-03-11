const API_BASE = 'https://api.torn.com';
const CLOUDFLARE_WORKER = 'https://kfcrace.deviyl.workers.dev/save-event';

function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

function setCookie(name, value, days = 7) {
    const d = new Date();
    d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
    const expires = `expires=${d.toUTCString()}`;
    document.cookie = `${name}=${value};${expires};path=/`;
}

function clearCookie(name) {
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/`;
}

function formatUTC(timestamp) {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString('en-US', { timeZone: 'UTC' }) + ' TCT';
}

let apiKey = getCookie('tornApiKey');

async function callTornAPI(endpoint) {
    if (!apiKey) {
        throw new Error('API key not set');
    }

    try {
        const response = await fetch(`${API_BASE}${endpoint}&key=${apiKey}`);
        if (!response.ok) {
            throw new Error(`API Error: ${response.statusText}`);
        }
        return await response.json();
    } catch (error) {
        console.error('API Call Error:', error);
        throw error;
    }
}

async function getPlayerInfo(playerId) {
    try {
        const data = await callTornAPI(`/user/${playerId}/?selections=profile`);
        return {
            id: data.player_id,
            name: data.name,
            rank: data.rank,
        };
    } catch (error) {
        console.error(`Failed to fetch player ${playerId}:`, error);
        throw error;
    }
}

async function getRaceResults(raceName) {
    try {
        const data = await callTornAPI('/v2/user/races?limit=20&cat=custom');
        const race = data.races.find(r => r.title === raceName);
        if (!race) {
            return null;
        }

        return {
            id: race.id,
            title: race.title,
            status: race.status,
            schedule: race.schedule,
            results: race.results || [],
        };
    } catch (error) {
        console.error('Failed to fetch race results:', error);
        throw error;
    }
}

async function fetchEventFromGitHub(eventName) {
    try {
        const rawUrl = `https://raw.githubusercontent.com/deviyl/kfc-grand-prix/main/races/${encodeURIComponent(eventName)}.json`;
        const response = await fetch(rawUrl);
        
        if (!response.ok) {
            throw new Error('Event not found on GitHub');
        }
        
        const eventData = await response.json();
        localStorage.setItem(`event_${eventName}`, JSON.stringify(eventData));
        
        return eventData;
    } catch (error) {
        console.error('Error fetching from GitHub:', error);
        throw error;
    }
}

async function saveEventToGitHub(eventName, eventData) {
    try {
        const response = await fetch(CLOUDFLARE_WORKER, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                action: 'save-event',
                eventName: eventName,
                eventData: eventData,
            }),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(`Error saving to GitHub: ${error.error || response.statusText}`);
        }

        return true;
    } catch (error) {
        console.error('Save to GitHub error:', error);
        throw error;
    }
}

class EventManager {
    constructor() {
        this.currentEvent = null;
        this.eventData = null;
    }

    loadEvent(eventName) {
        try {
            const stored = localStorage.getItem(`event_${eventName}`);
            if (stored) {
                this.eventData = JSON.parse(stored);
                this.currentEvent = eventName;
                return this.eventData;
            }
            throw new Error(`Event "${eventName}" not found`);
        } catch (error) {
            console.error('Error loading event:', error);
            throw error;
        }
    }

    async createEvent(eventConfig) {
        const eventData = {
            name: eventConfig.eventName,
            createdAt: new Date().toISOString(),
            races: eventConfig.raceNames.map((name, index) => ({
                index: index,
                name: name,
                tornRaceId: null,
                status: 'pending',
                results: [],
            })),
            teams: eventConfig.teamMode === 'teams' ? eventConfig.teams : null,
            players: [],
            prizes: {
                first: eventConfig.prize1st,
                second: eventConfig.prize2nd,
                third: eventConfig.prize3rd,
            },
            standings: {
                individual: [],
                team: [],
            },
        };

        localStorage.setItem(`event_${eventConfig.eventName}`, JSON.stringify(eventData));
        
        await saveEventToGitHub(eventConfig.eventName, eventData);
        
        this.eventData = eventData;
        this.currentEvent = eventConfig.eventName;

        return eventData;
    }

    async updateEvent(eventConfig) {
        if (!this.eventData) throw new Error('No event loaded');

        this.eventData.name = eventConfig.eventName;
        this.eventData.races = eventConfig.raceNames.map((name, index) => ({
            index: index,
            name: name,
            tornRaceId: this.eventData.races[index]?.tornRaceId || null,
            status: this.eventData.races[index]?.status || 'pending',
            results: this.eventData.races[index]?.results || [],
        }));
        this.eventData.prizes = {
            first: eventConfig.prize1st,
            second: eventConfig.prize2nd,
            third: eventConfig.prize3rd,
        };

        if (eventConfig.teamMode === 'teams') {
            this.eventData.teams = eventConfig.teams;
        } else {
            this.eventData.teams = null;
        }

        localStorage.removeItem(`event_${this.currentEvent}`);
        localStorage.setItem(`event_${eventConfig.eventName}`, JSON.stringify(this.eventData));
        
        await saveEventToGitHub(eventConfig.eventName, this.eventData);
        
        this.currentEvent = eventConfig.eventName;

        return this.eventData;
    }

    addPlayer(playerId, playerName) {
        if (!this.eventData) throw new Error('No event loaded');

        const exists = this.eventData.players.some(p => p.id === playerId);
        if (exists) throw new Error('Player already added');

        this.eventData.players.push({
            id: playerId,
            name: playerName,
            team: null,
            races: [],
        });

        this.saveEvent();
    }

    removePlayer(playerId) {
        if (!this.eventData) throw new Error('No event loaded');

        this.eventData.players = this.eventData.players.filter(p => p.id !== playerId);
        this.saveEvent();
    }

    addTeam(teamName) {
        if (!this.eventData) throw new Error('No event loaded');
        if (!this.eventData.teams) this.eventData.teams = [];

        this.eventData.teams.push({
            name: teamName,
            members: [],
        });

        this.saveEvent();
    }

    removeTeam(teamName) {
        if (!this.eventData) throw new Error('No event loaded');

        this.eventData.teams = this.eventData.teams.filter(t => t.name !== teamName);
        this.eventData.players.forEach(p => {
            if (p.team === teamName) p.team = null;
        });

        this.saveEvent();
    }

    updateTeamName(oldName, newName) {
        if (!this.eventData) throw new Error('No event loaded');

        const team = this.eventData.teams.find(t => t.name === oldName);
        if (team) {
            team.name = newName;
            this.eventData.players.forEach(p => {
                if (p.team === oldName) p.team = newName;
            });
            this.saveEvent();
        }
    }

    assignPlayerToTeam(playerId, teamName) {
        if (!this.eventData) throw new Error('No event loaded');

        const player = this.eventData.players.find(p => p.id === playerId);
        if (player) {
            player.team = teamName;
            this.saveEvent();
        }
    }

    removePlayerFromTeam(playerId) {
        if (!this.eventData) throw new Error('No event loaded');

        const player = this.eventData.players.find(p => p.id === playerId);
        if (player) {
            player.team = null;
            this.saveEvent();
        }
    }

    async fetchRaceResults(raceIndex) {
        if (!this.eventData) throw new Error('No event loaded');

        const race = this.eventData.races[raceIndex];
        if (!race) throw new Error('Race not found');

        const raceResults = await getRaceResults(race.name);
        
        if (!raceResults) {
            return null;
        }

        race.tornRaceId = raceResults.id;
        race.status = raceResults.status;
        
        const knownPlayerIds = new Set(this.eventData.players.map(p => p.id));
        
        const filteredResults = raceResults.results
            .filter(result => knownPlayerIds.has(result.driver_id))
            .sort((a, b) => a.position - b.position)
            .map((result, index) => ({
                ...result,
                position: index + 1
            }));
        
        race.results = filteredResults;

        this.calculateStandings();
        this.saveEvent();

        return race;
    }

    calculateStandings() {
        if (!this.eventData) return;

        const standings = {
            individual: [],
            team: [],
        };

        const playerScores = {};
        const totalRegisteredPlayers = this.eventData.players.length;

        this.eventData.players.forEach(player => {
            playerScores[player.id] = {
                id: player.id,
                name: player.name,
                totalScore: 0,
                raceScores: [],
                team: player.team,
            };
        });

        this.eventData.races.forEach((race, raceIndex) => {
            race.results.forEach(result => {
                const playerId = result.driver_id;
                if (playerScores[playerId]) {
                    const score = totalRegisteredPlayers - (result.position - 1);
                    playerScores[playerId].totalScore += score;
                    playerScores[playerId].raceScores.push({
                        race: raceIndex,
                        position: result.position,
                        score: score,
                    });
                }
            });
        });

        standings.individual = Object.values(playerScores).sort((a, b) => b.totalScore - a.totalScore);

        if (this.eventData.teams) {
            const teamScores = {};

            this.eventData.teams.forEach(team => {
                teamScores[team.name] = {
                    name: team.name,
                    totalScore: 0,
                    members: [],
                };
            });

            standings.individual.forEach(player => {
                if (player.team && teamScores[player.team]) {
                    teamScores[player.team].members.push(player);
                    teamScores[player.team].totalScore += player.totalScore;
                }
            });

            standings.team = Object.values(teamScores).sort((a, b) => b.totalScore - a.totalScore);
        }

        this.eventData.standings = standings;
    }

    saveEvent() {
        if (!this.eventData) throw new Error('No event loaded');
        localStorage.setItem(`event_${this.eventData.name}`, JSON.stringify(this.eventData));
    }

    deleteEvent() {
        if (!this.currentEvent) throw new Error('No event loaded');
        localStorage.removeItem(`event_${this.currentEvent}`);
        this.eventData = null;
        this.currentEvent = null;
    }

    listEvents() {
        const events = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('event_')) {
                const data = JSON.parse(localStorage.getItem(key));
                events.push(data);
            }
        }
        return events.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
}

const eventManager = new EventManager();

const authPanel = document.getElementById('authPanel');
const adminPanel = document.getElementById('adminPanel');
const authForm = document.getElementById('authForm');
const authError = document.getElementById('authError');
const logoutBtn = document.getElementById('logoutBtn');
const clearApiBtn = document.getElementById('clearApiBtn');

authForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const inputApiKey = document.getElementById('apiKey').value;
    const inputPassword = document.getElementById('adminPassword').value;

    try {
        const passwordResponse = await fetch(CLOUDFLARE_WORKER, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                action: 'validate-password',
                password: inputPassword,
            }),
        });

        if (!passwordResponse.ok) {
            authError.textContent = 'Invalid admin password';
            authError.style.display = 'block';
            return;
        }

        apiKey = inputApiKey;
        setCookie('tornApiKey', inputApiKey);
        
        await callTornAPI('/v2/user/races?limit=1&cat=custom');

        authPanel.style.display = 'none';
        adminPanel.style.display = 'block';
        initializeAdmin();
    } catch (error) {
        authError.textContent = 'Invalid API key or network error';
        authError.style.display = 'block';
        apiKey = null;
    }
});

logoutBtn.addEventListener('click', () => {
    clearCookie('tornApiKey');
    apiKey = null;
    authPanel.style.display = 'flex';
    adminPanel.style.display = 'none';
    authForm.reset();
    authError.style.display = 'none';
});

clearApiBtn.addEventListener('click', () => {
    clearCookie('tornApiKey');
    apiKey = null;
    alert('API key cleared');
});

function initializeAdmin() {
    setupEventManagement();
    setupPlayerManagement();
    setupRaceResults();
}

function setupEventManagement() {
    const newEventBtn = document.getElementById('newEventBtn');
    const loadEventBtn = document.getElementById('loadEventBtn');
    const eventFormContainer = document.getElementById('eventFormContainer');
    const eventForm = document.getElementById('eventForm');
    const cancelEventBtn = document.getElementById('cancelEventBtn');
    const numRaces = document.getElementById('numRaces');
    const raceNamesContainer = document.getElementById('raceNamesContainer');
    const teamModeRadios = document.querySelectorAll('input[name="teamMode"]');
    const teamsContainer = document.getElementById('teamsContainer');
    const addTeamBtn = document.getElementById('addTeamBtn');
    const activeEventDisplay = document.getElementById('activeEventDisplay');
    const editEventBtn = document.getElementById('editEventBtn');
    const deleteEventBtn = document.getElementById('deleteEventBtn');

    let editingEvent = false;

    newEventBtn.addEventListener('click', () => {
        editingEvent = false;
        document.getElementById('eventFormTitle').textContent = 'Create New Event';
        eventForm.reset();
        document.getElementById('eventName').value = '';
        document.getElementById('numRaces').value = '1';
        document.getElementById('prize1st').value = '';
        document.getElementById('prize2nd').value = '';
        document.getElementById('prize3rd').value = '';
        document.querySelector('input[name="teamMode"][value="individual"]').checked = true;
        teamsContainer.style.display = 'none';
        document.getElementById('teamsList').innerHTML = '';
        raceNamesContainer.innerHTML = '';
        eventFormContainer.style.display = 'block';
        activeEventDisplay.style.display = 'none';
        generateRaceNameInputs(1);
    });

    loadEventBtn.addEventListener('click', async () => {
        const loadEventBtn = document.getElementById('loadEventBtn');
        const originalText = loadEventBtn.textContent;
        
        try {
            loadEventBtn.disabled = true;
            loadEventBtn.textContent = 'Fetching events...';
            
            const response = await fetch(CLOUDFLARE_WORKER, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    action: 'list-events',
                }),
            });

            if (!response.ok) {
                throw new Error('Failed to fetch event list');
            }

            const data = await response.json();
            const knownEvents = data.events || [];
            
            if (knownEvents.length === 0) {
                alert('No events found');
                loadEventBtn.disabled = false;
                loadEventBtn.textContent = originalText;
                return;
            }

            const modal = document.createElement('div');
            modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:9999;';
            
            const content = document.createElement('div');
            content.style.cssText = 'background:#2d2d2d;border:2px solid #d4af37;border-radius:8px;padding:24px;max-width:400px;color:#fff;';
            
            content.innerHTML = `
                <h3 style="margin-bottom:16px;color:#d4af37;">Select Event to Load</h3>
                <select id="eventDropdown" style="width:100%;padding:8px;margin-bottom:16px;background:#1a1a1a;color:#fff;border:1px solid #d4af37;border-radius:4px;">
                    ${knownEvents.map(e => `<option value="${e}">${e}</option>`).join('')}
                </select>
                <div style="display:flex;gap:8px;">
                    <button id="confirmLoad" style="flex:1;padding:8px;background:#d4af37;color:#1a1a1a;border:none;border-radius:4px;cursor:pointer;font-weight:600;">Load</button>
                    <button id="cancelLoad" style="flex:1;padding:8px;background:#444;color:#fff;border:none;border-radius:4px;cursor:pointer;">Cancel</button>
                </div>
            `;
            
            modal.appendChild(content);
            document.body.appendChild(modal);

            document.getElementById('confirmLoad').addEventListener('click', async () => {
                const eventName = document.getElementById('eventDropdown').value;
                const confirmBtn = document.getElementById('confirmLoad');
                const confirmOriginalText = confirmBtn.textContent;
                
                try {
                    confirmBtn.disabled = true;
                    confirmBtn.textContent = 'Loading...';
                    
                    await fetchEventFromGitHub(eventName);
                    eventManager.loadEvent(eventName);
                    await displayActiveEvent();
                    modal.remove();
                } catch (error) {
                    alert('Error loading event: ' + error.message);
                    confirmBtn.disabled = false;
                    confirmBtn.textContent = confirmOriginalText;
                }
            });

            document.getElementById('cancelLoad').addEventListener('click', () => {
                modal.remove();
                loadEventBtn.disabled = false;
                loadEventBtn.textContent = originalText;
            });
            
            loadEventBtn.disabled = false;
            loadEventBtn.textContent = originalText;
        } catch (error) {
            alert('Error: ' + error.message);
            loadEventBtn.disabled = false;
            loadEventBtn.textContent = originalText;
        }
    });

    numRaces.addEventListener('change', (e) => {
        const count = parseInt(e.target.value);
        generateRaceNameInputs(count);
    });

    function generateRaceNameInputs(count) {
        raceNamesContainer.innerHTML = '';
        for (let i = 0; i < count; i++) {
            const group = document.createElement('div');
            group.className = 'race-name-input-group';
            group.innerHTML = `
                <div class="form-group">
                    <label for="raceName${i}">Race ${i + 1} Name</label>
                    <input 
                        type="text" 
                        id="raceName${i}" 
                        class="race-name-input"
                        placeholder="e.g., KFC Grand Prix"
                        required
                    >
                </div>
            `;
            raceNamesContainer.appendChild(group);
        }
    }

    teamModeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            teamsContainer.style.display = e.target.value === 'teams' ? 'block' : 'none';
            if (e.target.value === 'teams' && document.getElementById('teamsList').innerHTML === '') {
                addTeamBtn.click();
            }
        });
    });

    addTeamBtn.addEventListener('click', () => {
        const teamsList = document.getElementById('teamsList');
        const teamCard = document.createElement('div');
        teamCard.className = 'team-card';
        teamCard.innerHTML = `
            <div class="team-input-group">
                <input type="text" class="team-name-input" placeholder="Team name" required>
                <button type="button" class="btn btn-danger" style="width: auto;">Remove</button>
            </div>
        `;
        teamCard.querySelector('.btn-danger').addEventListener('click', () => {
            teamCard.remove();
        });
        teamsList.appendChild(teamCard);
    });

    cancelEventBtn.addEventListener('click', () => {
        eventFormContainer.style.display = 'none';
        if (eventManager.eventData) {
            displayActiveEvent();
        }
    });

    eventForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const raceNames = Array.from(document.querySelectorAll('.race-name-input'))
            .map(input => input.value);

        const teams = Array.from(document.querySelectorAll('.team-name-input'))
            .filter(input => input.value)
            .map(input => ({
                name: input.value,
                members: [],
            }));

        const eventConfig = {
            eventName: document.getElementById('eventName').value,
            raceNames: raceNames,
            teamMode: document.querySelector('input[name="teamMode"]:checked').value,
            teams: teams,
            prize1st: document.getElementById('prize1st').value,
            prize2nd: document.getElementById('prize2nd').value,
            prize3rd: document.getElementById('prize3rd').value,
        };

        try {
            const submitBtn = eventForm.querySelector('button[type="submit"]');
            submitBtn.disabled = true;
            submitBtn.textContent = 'Saving...';

            if (editingEvent && eventManager.eventData) {
                await eventManager.updateEvent(eventConfig);
            } else {
                await eventManager.createEvent(eventConfig);
            }
            eventFormContainer.style.display = 'none';
            displayActiveEvent();
            alert('Event saved successfully!');

            submitBtn.disabled = false;
            submitBtn.textContent = 'Save Event';
        } catch (error) {
            alert('Error saving event: ' + error.message);
            const submitBtn = eventForm.querySelector('button[type="submit"]');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Save Event';
        }
    });

    editEventBtn.addEventListener('click', () => {
        editingEvent = true;
        document.getElementById('eventFormTitle').textContent = 'Edit Event';
        
        document.getElementById('eventName').value = eventManager.eventData.name;
        document.getElementById('numRaces').value = eventManager.eventData.races.length;
        document.getElementById('prize1st').value = eventManager.eventData.prizes.first;
        document.getElementById('prize2nd').value = eventManager.eventData.prizes.second;
        document.getElementById('prize3rd').value = eventManager.eventData.prizes.third;
        
        generateRaceNameInputs(eventManager.eventData.races.length);
        
        eventManager.eventData.races.forEach((race, index) => {
            document.getElementById(`raceName${index}`).value = race.name;
        });

        if (eventManager.eventData.teams) {
            document.querySelector('input[name="teamMode"][value="teams"]').checked = true;
            teamsContainer.style.display = 'block';
            document.getElementById('teamsList').innerHTML = '';
            eventManager.eventData.teams.forEach(team => {
                const teamCard = document.createElement('div');
                teamCard.className = 'team-card';
                teamCard.innerHTML = `
                    <div class="team-input-group">
                        <input type="text" class="team-name-input" value="${team.name}" required>
                        <button type="button" class="btn btn-danger" style="width: auto;">Remove</button>
                    </div>
                    <div style="margin-top:8px;padding-top:8px;border-top:1px solid #333;">
                        <div style="font-size:12px;color:#b0b0b0;margin-bottom:8px;">Members:</div>
                        <div class="team-members-drag" style="display:flex;flex-wrap:wrap;gap:6px;min-height:30px;padding:8px;background:rgba(0,0,0,0.2);border-radius:4px;">
                            ${eventManager.eventData.players
                                .filter(p => p.team === team.name)
                                .map(p => `<span style="background:#d4af37;color:#1a1a1a;padding:4px 8px;border-radius:4px;font-size:12px;font-weight:600;">${p.name}</span>`)
                                .join('')}
                        </div>
                    </div>
                `;
                teamCard.querySelector('.btn-danger').addEventListener('click', () => {
                    teamCard.remove();
                });
                document.getElementById('teamsList').appendChild(teamCard);
            });
        }

        eventFormContainer.style.display = 'block';
        activeEventDisplay.style.display = 'none';
    });

    deleteEventBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to delete this event? This cannot be undone.')) {
            eventManager.deleteEvent();
            eventFormContainer.style.display = 'none';
            activeEventDisplay.style.display = 'none';
            alert('Event deleted');
        }
    });

    async function displayActiveEvent() {
        if (!eventManager.eventData) return;

        document.getElementById('displayEventName').textContent = eventManager.eventData.name;
        document.getElementById('displayNumRaces').textContent = eventManager.eventData.races.length;
        document.getElementById('currentEventName').textContent = eventManager.eventData.name;

        eventFormContainer.style.display = 'none';
        activeEventDisplay.style.display = 'block';

        document.getElementById('playerManagementSection').style.display = 'block';
        document.getElementById('raceResultsSection').style.display = 'block';
        document.getElementById('standingsSection').style.display = 'block';

        eventManager.calculateStandings();
        displayStandings();
        displayPlayers();
        displayRaces();
        
        await saveEventToGitHub(eventManager.eventData.name, eventManager.eventData);
    }
}

function displayPlayers() {
    if (!eventManager.eventData) return;

    const playersContainer = document.getElementById('playersContainer');
    playersContainer.innerHTML = '';

    if (eventManager.eventData.teams) {
        const teamsHTML = eventManager.eventData.teams.map(team => {
            const teamPlayers = eventManager.eventData.players.filter(p => p.team === team.name);
            
            return `
                <div style="border:1px solid #d4af37;border-radius:6px;padding:12px;margin-bottom:12px;background:rgba(212,175,55,0.05);">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                        <h4 style="color:#d4af37;margin:0;font-size:14px;">${team.name}</h4>
                        <div style="display:flex;gap:6px;">
                            <button class="edit-team-btn btn btn-secondary" data-team="${team.name}" style="padding:4px 8px;font-size:11px;">Edit</button>
                            <button class="delete-team-btn btn btn-danger" data-team="${team.name}" style="padding:4px 8px;font-size:11px;">Delete</button>
                        </div>
                    </div>
                    <div class="team-drop-zone" data-team="${team.name}" style="background:rgba(0,0,0,0.3);border:2px dashed #d4af37;border-radius:4px;padding:8px;min-height:30px;margin-bottom:8px;">
                        ${teamPlayers.map(p => `
                            <div class="player-card" draggable="true" data-player-id="${p.id}" style="display:inline-block;margin:2px;">
                                <span style="background:#d4af37;color:#1a1a1a;padding:4px 8px;border-radius:4px;font-weight:600;display:inline-block;font-size:12px;">
                                    ${p.name}
                                    <button class="remove-from-team" data-player-id="${p.id}" style="background:transparent;border:none;color:#1a1a1a;cursor:pointer;margin-left:4px;font-weight:bold;font-size:11px;">✕</button>
                                </span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }).join('');

        const unassignedHTML = `
            <div style="border:1px solid #666;border-radius:6px;padding:12px;background:rgba(0,0,0,0.2);">
                <h4 style="color:#b0b0b0;margin:0 0 8px 0;font-size:13px;">Unassigned Players</h4>
                <div id="unassigned-drop-zone" style="display:flex;flex-wrap:wrap;gap:6px;min-height:30px;">
                    ${eventManager.eventData.players.filter(p => !p.team).map(p => `
                        <div class="player-card" draggable="true" data-player-id="${p.id}">
                            <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,0.1);padding:6px 10px;border-radius:4px;font-size:12px;">
                                <span style="color:#fff;font-weight:600;">${p.name}</span>
                                <button class="delete-player-btn" data-player-id="${p.id}" style="background:transparent;border:none;color:#ff1744;cursor:pointer;margin-left:6px;font-weight:bold;font-size:11px;">✕</button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        playersContainer.innerHTML = teamsHTML + unassignedHTML;

        setupDragDrop();
        setupTeamEditing();
        setupTeamDeletion();
        setupPlayerRemoval();
    } else {
        eventManager.eventData.players.forEach(player => {
            const card = document.createElement('div');
            card.className = 'player-card';
            card.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;background:rgba(0,0,0,0.3);padding:10px;border-radius:6px;border:1px solid #d4af37;font-size:12px;">
                    <span style="color:#fff;font-weight:600;">${player.name}</span>
                    <span style="color:#b0b0b0;font-size:11px;margin:0 8px;">ID: ${player.id}</span>
                    <button class="delete-player-btn btn btn-danger" data-player-id="${player.id}" style="padding:4px 8px;font-size:11px;">✕</button>
                </div>
            `;
            playersContainer.appendChild(card);
        });

        setupPlayerRemoval();
    }
}

function setupDragDrop() {
    const playerCards = document.querySelectorAll('.player-card[draggable="true"]');
    const dropZones = document.querySelectorAll('.team-drop-zone, #unassigned-drop-zone');

    playerCards.forEach(card => {
        card.addEventListener('dragstart', (e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('playerId', card.dataset.playerId);
        });
    });

    dropZones.forEach(zone => {
        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            zone.style.background = 'rgba(212, 175, 55, 0.2)';
        });

        zone.addEventListener('dragleave', () => {
            zone.style.background = zone.id === 'unassigned-drop-zone' ? 'transparent' : 'rgba(0,0,0,0.3)';
        });

        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            const playerId = parseInt(e.dataTransfer.getData('playerId'));
            const teamName = zone.dataset.team;

            if (teamName) {
                eventManager.assignPlayerToTeam(playerId, teamName);
            } else {
                eventManager.removePlayerFromTeam(playerId);
            }

            zone.style.background = zone.id === 'unassigned-drop-zone' ? 'transparent' : 'rgba(0,0,0,0.3)';
            displayPlayers();
            displayStandings();
        });
    });
}

function setupTeamEditing() {
    document.querySelectorAll('.edit-team-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const teamName = btn.dataset.team;
            const newName = prompt(`Edit team name:`, teamName);
            if (newName && newName !== teamName) {
                eventManager.updateTeamName(teamName, newName);
                displayPlayers();
                displayStandings();
            }
        });
    });
}

function setupTeamDeletion() {
    document.querySelectorAll('.delete-team-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const teamName = btn.dataset.team;
            if (confirm(`Delete team "${teamName}"? Players will be unassigned.`)) {
                eventManager.removeTeam(teamName);
                displayPlayers();
                displayStandings();
            }
        });
    });
}

function setupPlayerRemoval() {
    document.querySelectorAll('.delete-player-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const playerId = parseInt(btn.dataset.playerId);
            const player = eventManager.eventData.players.find(p => p.id === playerId);
            
            if (!player) return;
            
            const playerName = player.name || `Player ${playerId}`;
            if (confirm(`Remove player "${playerName}"?`)) {
                eventManager.removePlayer(playerId);
                displayPlayers();
                displayStandings();
            }
        });
    });
}

function setupPlayerManagement() {
    const playerIdInput = document.getElementById('playerIdInput');
    const addPlayerBtn = document.getElementById('addPlayerBtn');
    const playersContainer = document.getElementById('playersContainer');
    const playerError = document.getElementById('playerError');
    const savePlayersBtn = document.getElementById('savePlayersBtn');

    savePlayersBtn.addEventListener('click', async () => {
        try {
            savePlayersBtn.disabled = true;
            savePlayersBtn.textContent = 'Saving...';

            await saveEventToGitHub(eventManager.eventData.name, eventManager.eventData);
            alert('Players and teams saved successfully!');

            savePlayersBtn.disabled = false;
            savePlayersBtn.textContent = 'Save Players & Teams';
        } catch (error) {
            alert('Error saving: ' + error.message);
            savePlayersBtn.disabled = false;
            savePlayersBtn.textContent = 'Save Players & Teams';
        }
    });

    addPlayerBtn.addEventListener('click', async () => {
        const playerId = parseInt(playerIdInput.value);
        if (!playerId) {
            playerError.textContent = 'Please enter a valid player ID';
            playerError.style.display = 'block';
            return;
        }

        try {
            playerError.style.display = 'none';
            addPlayerBtn.disabled = true;
            addPlayerBtn.textContent = 'Loading...';

            const playerInfo = await getPlayerInfo(playerId);
            
            if (!playerInfo || !playerInfo.name) {
                throw new Error('Player not found');
            }
            
            eventManager.addPlayer(playerInfo.id, playerInfo.name);

            playerIdInput.value = '';
            displayPlayers();

        } catch (error) {
            playerError.textContent = 'Error: ' + error.message;
            playerError.style.display = 'block';
        } finally {
            addPlayerBtn.disabled = false;
            addPlayerBtn.textContent = '+ Add Player';
        }
    });

    if (eventManager.eventData) {
        displayPlayers();
    }
}

function displayRaces() {
    if (!eventManager.eventData) return;

    const racesDisplay = document.getElementById('racesDisplay');
    racesDisplay.innerHTML = '';

    eventManager.eventData.races.forEach((race, index) => {
        const card = document.createElement('div');
        card.className = 'race-card';
        card.innerHTML = `
            <div class="race-title">Race ${index + 1}: ${race.name}</div>
            <div class="race-info">
                <div class="race-info-item">
                    <span>Status:</span>
                    <span>${race.status || 'pending'}</span>
                </div>
                <div class="race-info-item">
                    <span>Finishers:</span>
                    <span>${race.results.length}</span>
                </div>
            </div>
            <div class="race-results">
                ${race.results.length ? race.results.slice(0, 10).map(result => {
                    const player = eventManager.eventData.players.find(p => p.id === result.driver_id);
                    const points = race.results.length - (result.position - 1);
                    return `
                        <div class="result-row">
                            <span class="result-position">#${result.position}</span>
                            <span class="result-name">${player ? player.name : `Driver ${result.driver_id}`}</span>
                            <span class="result-score">${points}pts</span>
                        </div>
                    `;
                }).join('') : '<p style="color: var(--text-secondary); font-size: 12px;">No results yet</p>'}
            </div>
        `;
        racesDisplay.appendChild(card);
    });
}

function displayStandings() {
    if (!eventManager.eventData) return;

    const standingsDisplay = document.getElementById('standingsDisplay');
    const standings = eventManager.eventData.standings;

    let html = '<table class="standings-table"><thead><tr>';
    html += '<th>Rank</th><th>Name</th>';
    
    eventManager.eventData.races.forEach((race, index) => {
        html += `<th>R${index + 1}</th>`;
    });
    
    html += '<th>Total Score</th></tr></thead><tbody>';

    standings.individual.forEach((player, index) => {
        html += `<tr>
            <td class="standings-rank">${index + 1}</td>
            <td class="standings-name">${player.name}</td>`;
        
        eventManager.eventData.races.forEach((_, raceIndex) => {
            const raceScore = player.raceScores.find(rs => rs.race === raceIndex);
            html += `<td>${raceScore ? raceScore.score + ' pts' : '-'}</td>`;
        });
        
        html += `<td class="standings-score">${player.totalScore}</td></tr>`;
    });

    html += '</tbody></table>';

    if (standings.team && standings.team.length > 0) {
        html += '<h3 style="margin-top: 32px; color: var(--primary);">Team Standings</h3>';
        html += '<table class="standings-table"><thead><tr>';
        html += '<th>Rank</th><th>Team</th><th>Members</th><th>Total Score</th></tr></thead><tbody>';

        standings.team.forEach((team, index) => {
            html += `<tr>
                <td class="standings-rank">${index + 1}</td>
                <td class="standings-name">${team.name}</td>
                <td>${team.members.length}</td>
                <td class="standings-score">${team.totalScore}</td>
            </tr>`;
        });

        html += '</tbody></table>';
    }

    standingsDisplay.innerHTML = html;
}

function setupRaceResults() {
    const fetchResultsBtn = document.getElementById('fetchResultsBtn');
    const fetchStatus = document.getElementById('fetchStatus');

    fetchResultsBtn.addEventListener('click', async () => {
        if (!eventManager.eventData) {
            alert('No event loaded');
            return;
        }

        fetchResultsBtn.disabled = true;
        fetchStatus.textContent = 'Fetching...';
        fetchStatus.className = 'status-text loading';

        try {
            let fetchedCount = 0;
            let notFoundCount = 0;

            for (let i = 0; i < eventManager.eventData.races.length; i++) {
                const result = await eventManager.fetchRaceResults(i);
                if (result) {
                    fetchedCount++;
                } else {
                    notFoundCount++;
                }
            }

            let message = `${fetchedCount} race(s) fetched successfully`;
            if (notFoundCount > 0) {
                message += ` (${notFoundCount} not found - races may not have started yet)`;
            }

            fetchStatus.textContent = message;
            fetchStatus.className = 'status-text success';
            
            await saveEventToGitHub(eventManager.eventData.name, eventManager.eventData);

            setTimeout(() => {
                fetchStatus.textContent = '';
                fetchStatus.className = 'status-text';
            }, 4000);

            eventManager.calculateStandings();
            displayRaces();
            displayStandings();

        } catch (error) {
            fetchStatus.textContent = 'Error: ' + error.message;
            fetchStatus.className = 'status-text error';
        } finally {
            fetchResultsBtn.disabled = false;
        }
    });
}


if (getCookie('tornApiKey')) {
    apiKey = getCookie('tornApiKey');
    authPanel.style.display = 'none';
    adminPanel.style.display = 'block';
    initializeAdmin();
}
