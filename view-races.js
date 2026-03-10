const eventSelect = document.getElementById('eventSelect');
const eventInfoPanel = document.getElementById('eventInfoPanel');
const emptyState = document.getElementById('emptyState');
const tabButtons = document.querySelectorAll('.tab-button');
const tabContents = document.querySelectorAll('.tab-content');

let currentEventData = null;


function loadAllEvents() {
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

function populateEventSelector() {
    const events = loadAllEvents();

    if (events.length === 0) {
        eventInfoPanel.style.display = 'none';
        emptyState.style.display = 'block';
        eventSelect.innerHTML = '<option value="">No events available</option>';
        eventSelect.disabled = true;
        return;
    }

    emptyState.style.display = 'none';
    eventSelect.disabled = false;

    events.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    eventSelect.innerHTML = '';
    events.forEach((event, index) => {
        const option = document.createElement('option');
        option.value = event.name;
        option.textContent = event.name;
        eventSelect.appendChild(option);
    });

    if (events.length > 0) {
        eventSelect.value = events[0].name;
        displayEvent(events[0]);
    }
}

eventSelect.addEventListener('change', (e) => {
    if (!e.target.value) return;

    const events = loadAllEvents();
    const event = events.find(ev => ev.name === e.target.value);
    if (event) {
        displayEvent(event);
    }
});


function displayEvent(eventData) {
    currentEventData = eventData;
    eventInfoPanel.style.display = 'block';

    document.getElementById('eventTitle').textContent = eventData.name;
    document.getElementById('eventStatusDisplay').textContent = eventData.status.toUpperCase();
    document.getElementById('eventRaceCount').textContent = eventData.races.length;

    const createdDate = new Date(eventData.createdAt).toLocaleDateString('en-US', {
        timeZone: 'UTC',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
    document.getElementById('eventDates').textContent = `Created: ${createdDate} TCT`;

    if (eventData.prizes && (eventData.prizes.first || eventData.prizes.second || eventData.prizes.third)) {
        document.getElementById('prizesSection').style.display = 'block';
        document.getElementById('prize1Display').textContent = eventData.prizes.first || '—';
        document.getElementById('prize2Display').textContent = eventData.prizes.second || '—';
        document.getElementById('prize3Display').textContent = eventData.prizes.third || '—';
    } else {
        document.getElementById('prizesSection').style.display = 'none';
    }

    displayStandings(eventData);
    displayRaceResults(eventData);
}


function displayStandings(eventData) {
    const individualContainer = document.getElementById('individualStandingsContainer');
    const individualDisplay = document.getElementById('individualStandingsDisplay');
    const teamContainer = document.getElementById('teamStandingsContainer');
    const teamDisplay = document.getElementById('teamStandingsDisplay');

    individualDisplay.innerHTML = '';
    teamDisplay.innerHTML = '';

    const standings = eventData.standings || { individual: [], team: [] };

    if (standings.individual && standings.individual.length > 0) {
        let tableHtml = '<div class="standings-table-wrapper"><table class="standings-table"><thead><tr>';
        tableHtml += '<th>Rank</th><th>Name</th>';

        eventData.races.forEach((race, index) => {
            tableHtml += `<th>R${index + 1}</th>`;
        });

        tableHtml += '<th>Total</th></tr></thead><tbody>';

        standings.individual.forEach((player, index) => {
            tableHtml += `<tr>
                <td class="standings-rank">${index + 1}</td>
                <td class="standings-name">${player.name}</td>`;

            eventData.races.forEach((_, raceIndex) => {
                const raceScore = player.raceScores?.find(rs => rs.race === raceIndex);
                tableHtml += `<td class="standings-race-score ${raceScore ? '' : 'dnf'}">${raceScore ? raceScore.score : '—'}</td>`;
            });

            tableHtml += `<td class="standings-score">${player.totalScore}</td></tr>`;
        });

        tableHtml += '</tbody></table></div>';
        individualDisplay.innerHTML = tableHtml;
    } else {
        individualDisplay.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 32px;">No race results yet</p>';
    }

    if (standings.team && standings.team.length > 0) {
        teamContainer.style.display = 'block';

        let teamHtml = '<div class="standings-table-wrapper"><table class="standings-table"><thead><tr>';
        tableHtml += '<th>Rank</th><th>Team</th><th>Members</th>';

        eventData.races.forEach((race, index) => {
            tableHtml += `<th>R${index + 1}</th>`;
        });

        teamHtml += '<th>Total</th></tr></thead><tbody>';

        standings.team.forEach((team, index) => {
            teamHtml += `<tr>
                <td class="standings-rank">${index + 1}</td>
                <td class="standings-name">${team.name}</td>
                <td class="team-members-inline">${team.members.length} players</td>`;

            eventData.races.forEach((_, raceIndex) => {
                const raceTeamScore = team.members.reduce((sum, member) => {
                    const memberRaceScore = member.raceScores?.find(rs => rs.race === raceIndex);
                    return sum + (memberRaceScore ? memberRaceScore.score : 0);
                }, 0);
                teamHtml += `<td class="standings-race-score">${raceTeamScore || '—'}</td>`;
            });

            teamHtml += `<td class="standings-score">${team.totalScore}</td></tr>`;
        });

        teamHtml += '</tbody></table></div>';
        teamDisplay.innerHTML = teamHtml;
    } else {
        teamContainer.style.display = 'none';
    }
}


function displayRaceResults(eventData) {
    const racesDisplay = document.getElementById('racesResultsDisplay');
    racesDisplay.innerHTML = '';

    if (!eventData.races || eventData.races.length === 0) {
        racesDisplay.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 32px;">No races in this event</p>';
        return;
    }

    eventData.races.forEach((race, raceIndex) => {
        const card = document.createElement('div');
        card.className = 'race-result-card';

        const statusColor = race.status === 'finished' ? 'var(--success)' : 'var(--warning)';
        const statusText = race.status || 'pending';

        card.innerHTML = `
            <div class="race-result-header">
                <div class="race-result-title">Race ${raceIndex + 1}: ${race.name}</div>
                <div class="race-result-meta">
                    <span>Status: <strong style="color: ${statusColor};">${statusText.toUpperCase()}</strong></span>
                    <span>${race.results.length} Finishers</span>
                </div>
            </div>
            <div class="race-result-body">
                <div class="race-result-list">
                    ${race.results.length > 0 ? race.results.slice(0, 15).map((result, idx) => {
                        const totalParticipants = race.results.length;
                        const points = totalParticipants - (result.position - 1);
                        const isTop3 = result.position <= 3;

                        const playerInfo = eventData.players?.find(p => p.id === result.driver_id);
                        const driverName = playerInfo?.name || `Driver ${result.driver_id}`;

                        return `
                            <div class="race-result-item ${isTop3 ? 'top3' : ''}">
                                <div class="result-position">#${result.position}</div>
                                <div class="result-detail">
                                    <div class="result-driver">${driverName}</div>
                                    <div class="result-time">${(result.race_time / 60).toFixed(2)}m ${result.best_lap_time.toFixed(2)}s BLT</div>
                                </div>
                                <div class="result-points">${points}pts</div>
                            </div>
                        `;
                    }).join('') : '<p style="color: var(--text-secondary);">No results available</p>'}
                </div>
                ${race.results.length > 15 ? `<p style="text-align: center; color: var(--text-secondary); margin-top: 16px; font-size: 12px;">... and ${race.results.length - 15} more</p>` : ''}
            </div>
        `;

        racesDisplay.appendChild(card);
    });
}


tabButtons.forEach(button => {
    button.addEventListener('click', () => {
        const tabName = button.dataset.tab;

        tabButtons.forEach(btn => btn.classList.remove('active'));
        tabContents.forEach(content => content.classList.remove('active'));

        button.classList.add('active');
        document.getElementById(`${tabName}Tab`).classList.add('active');
    });
});


let autoRefreshEnabled = true;
const REFRESH_INTERVAL = 30000; // 30 seconds

function autoRefresh() {
    if (autoRefreshEnabled && currentEventData) {
        const events = loadAllEvents();
        const updated = events.find(ev => ev.name === currentEventData.name);
        if (updated) {
            currentEventData = updated;
            displayStandings(updated);
            displayRaceResults(updated);
        }
    }
}

document.addEventListener('mousemove', () => {
}, { once: false });

setInterval(autoRefresh, REFRESH_INTERVAL);


document.addEventListener('DOMContentLoaded', () => {
    populateEventSelector();
});
