const ADMIN_PASSWORD = 'NogLovesToes';
const API_BASE = 'https://api.torn.com';


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

async function getRaceResults(raceName, fromTimestamp = null, toTimestamp = null) {
    try {
        let endpoint = '/v2/user/races?limit=20&cat=custom';
        if (fromTimestamp) endpoint += `&from=${fromTimestamp}`;
        if (toTimestamp) endpoint += `&to=${toTimestamp}`;

        const data = await callTornAPI(endpoint);
        
        const race = data.races.find(r => r.title === raceName);
        if (!race) {
            throw new Error(`Race "${raceName}" not found in results`);
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


class EventManager {
    constructor() {
        this.currentEvent = null;
        this.eventData = null;
    }

    async loadEvent(eventName) {
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

    createEvent(eventConfig) {
        const eventData = {
            name: eventConfig.eventName,
            status: 'setup',
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
        this.eventData = eventData;
        this.currentEvent = eventConfig.eventName;

        return eventData;
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

    async fetchRaceResults(raceIndex) {
        if (!this.eventData) throw new Error('No event loaded');

        const race = this.eventData.races[raceIndex];
        if (!race) throw new Error('Race not found');

        const raceResults = await getRaceResults(race.name);
        
        race.tornRaceId = raceResults.id;
        race.status = raceResults.status;
        race.results = raceResults.results;

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
            const totalParticipants = race.results.length;

            race.results.forEach(result => {
                const playerId = result.driver_id;
                if (playerScores[playerId]) {
                    const score = totalParticipants - (result.position - 1);
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
        return events;
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

    if (inputPassword !== ADMIN_PASSWORD) {
        authError.textContent = 'Invalid admin password';
        authError.style.display = 'block';
        return;
    }

    try {
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
    const eventStatus = document.getElementById('eventStatus');

    let editingEvent = false;

    newEventBtn.addEventListener('click', () => {
        editingEvent = false;
        document.getElementById('eventFormTitle').textContent = 'Create New Event';
        eventForm.reset();
        raceNamesContainer.innerHTML = '';
        eventFormContainer.style.display = 'block';
        activeEventDisplay.style.display = 'none';
        generateRaceNameInputs(1);
    });

    loadEventBtn.addEventListener('click', () => {
        const events = eventManager.listEvents();
        if (events.length === 0) {
            alert('No events found');
            return;
        }

        const eventName = prompt('Enter event name to load:\n' + events.map(e => e.name).join('\n'));
        if (!eventName) return;

        try {
            eventManager.loadEvent(eventName);
            displayActiveEvent();
        } catch (error) {
            alert('Error loading event: ' + error.message);
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
                    <label for="raceName${i}">Race ${i + 1} Name (must match Torn race title)</label>
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
            if (e.target.value === 'teams') {
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

    eventForm.addEventListener('submit', (e) => {
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
            eventManager.createEvent(eventConfig);
            eventFormContainer.style.display = 'none';
            displayActiveEvent();
            alert('Event created successfully!');
        } catch (error) {
            alert('Error creating event: ' + error.message);
        }
    });

    editEventBtn.addEventListener('click', () => {
        editingEvent = true;
        document.getElementById('eventFormTitle').textContent = 'Edit Event';
        
        document.getElementById('eventName').value = eventManager.eventData.name;
        document.getElementById('numRaces').value = eventManager.eventData.races.length;
        generateRaceNameInputs(eventManager.eventData.races.length);
        
        eventManager.eventData.races.forEach((race, index) => {
            document.getElementById(`raceName${index}`).value = race.name;
        });

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

    eventStatus.addEventListener('change', (e) => {
        if (eventManager.eventData) {
            eventManager.eventData.status = e.target.value;
            eventManager.saveEvent();
        }
    });

    function displayActiveEvent() {
        if (!eventManager.eventData) return;

        document.getElementById('displayEventName').textContent = eventManager.eventData.name;
        document.getElementById('displayNumRaces').textContent = eventManager.eventData.races.length;
        eventStatus.value = eventManager.eventData.status;
        document.getElementById('currentEventName').textContent = eventManager.eventData.name + ' - ' + eventManager.eventData.status.toUpperCase();

        eventFormContainer.style.display = 'none';
        activeEventDisplay.style.display = 'block';

        displayStandings();
    }
}


function setupPlayerManagement() {
    const playerIdInput = document.getElementById('playerIdInput');
    const addPlayerBtn = document.getElementById('addPlayerBtn');
    const playersContainer = document.getElementById('playersContainer');
    const playerError = document.getElementById('playerError');

    addPlayerBtn.addEventListener('click', async () => {
        const playerId = parseInt(playerIdInput.value);
        if (!playerId) return;

        try {
            playerError.style.display = 'none';
            addPlayerBtn.disabled = true;
            addPlayerBtn.textContent = 'Loading...';

            const playerInfo = await getPlayerInfo(playerId);
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

    function displayPlayers() {
        if (!eventManager.eventData) return;

        playersContainer.innerHTML = '';

        eventManager.eventData.players.forEach(player => {
            const card = document.createElement('div');
            card.className = 'player-card';
            card.innerHTML = `
                <div class="player-info">
                    <div class="player-name">${player.name}</div>
                    <div class="player-id">ID: ${player.id}</div>
                </div>
                <button class="player-remove" data-id="${player.id}">✕</button>
            `;
            card.querySelector('.player-remove').addEventListener('click', () => {
                eventManager.removePlayer(player.id);
                displayPlayers();
            });
            playersContainer.appendChild(card);
        });
    }

    if (eventManager.eventData) {
        displayPlayers();
    }
}


function setupRaceResults() {
    const fetchResultsBtn = document.getElementById('fetchResultsBtn');
    const fetchStatus = document.getElementById('fetchStatus');
    const racesDisplay = document.getElementById('racesDisplay');

    fetchResultsBtn.addEventListener('click', async () => {
        if (!eventManager.eventData) {
            alert('No event loaded');
            return;
        }

        fetchResultsBtn.disabled = true;
        fetchStatus.textContent = 'Fetching...';
        fetchStatus.className = 'status-text loading';

        try {
            for (let i = 0; i < eventManager.eventData.races.length; i++) {
                await eventManager.fetchRaceResults(i);
            }

            fetchStatus.textContent = 'Results fetched successfully!';
            fetchStatus.className = 'status-text success';
            setTimeout(() => {
                fetchStatus.textContent = '';
                fetchStatus.className = 'status-text';
            }, 3000);

            displayRaces();
            displayStandings();

        } catch (error) {
            fetchStatus.textContent = 'Error: ' + error.message;
            fetchStatus.className = 'status-text error';
        } finally {
            fetchResultsBtn.disabled = false;
        }
    });

    function displayRaces() {
        if (!eventManager.eventData) return;

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
                    ${race.results.length ? race.results.slice(0, 10).map(result => `
                        <div class="result-row">
                            <span class="result-position">#${result.position}</span>
                            <span class="result-name">${result.driver_id}</span>
                            <span class="result-score">${race.results.length - (result.position - 1)}pts</span>
                        </div>
                    `).join('') : '<p style="color: var(--text-secondary); font-size: 12px;">No results yet</p>'}
                </div>
            `;
            racesDisplay.appendChild(card);
        });
    }
}


function displayStandings() {
    if (!eventManager.eventData) return;

    const standingsDisplay = document.getElementById('standingsDisplay');
    const standings = eventManager.eventData.standings;

    let html = '<table class="standings-table"><thead><tr>';
    html += '<th>Rank</th><th>Name</th>';
    
    eventManager.eventData.races.forEach((race, index) => {
        html += `<th>Race ${index + 1}</th>`;
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


if (getCookie('tornApiKey')) {
    apiKey = getCookie('tornApiKey');
    authPanel.style.display = 'none';
    adminPanel.style.display = 'block';
    initializeAdmin();
}
