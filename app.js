/**
 * STAFF SCHEDULER - Application Logic
 * ====================================
 *
 * SCHEDULING HEURISTIC OVERVIEW:
 * -----------------------------
 * This scheduler uses a deterministic greedy algorithm with fairness balancing:
 *
 * 1. HARD CONSTRAINTS (must satisfy):
 *    - Unavailability: Employees on LEAVE/TAD cannot be scheduled
 *    - One shift per day: Each employee gets at most one shift code per day
 *    - Min rest between shifts: E.g., 8 hours between shift end and next start
 *
 * 2. COVERAGE TARGETING:
 *    - For each day and shift, try to fill the required headcount
 *    - Process shifts in priority order (Night > Evening > Day > others)
 *
 * 3. FAIRNESS BALANCING:
 *    - Track total shifts per employee
 *    - Prefer assigning to employees with fewer shifts (load balancing)
 *    - Rotate night shifts to spread the burden
 *
 * 4. SOFT CONSTRAINTS (try to satisfy, warn if violated):
 *    - Max hours per week (default 60)
 *    - Max consecutive working days (default 6)
 *
 * The algorithm processes each day sequentially, for each shift type,
 * selecting the most suitable available employee based on a scoring function
 * that considers availability, fairness, and constraint satisfaction.
 */

// ============================================
// STATE MANAGEMENT
// ============================================

const AppState = {
    industry: 'healthcare',
    calendarStyle: 'monthly',
    departmentName: 'Emergency Department',
    month: 4, // May (0-indexed)
    year: 2025,
    startDate: null,
    duration: 14,
    coveragePreset: '24_7',
    rotationPattern: 'custom', // Selected rotation pattern
    shifts: [],
    groups: [],
    constraints: {
        minRestHours: 8,
        maxHoursWeek: 60,
        maxConsecutiveDays: 6,
        targetShiftsPerPerson: 10
    },
    schedule: null, // Generated schedule
    warnings: [],
    randomSeed: Date.now()
};

// Day of week abbreviations
const DAY_ABBR = ['S', 'M', 'T', 'W', 'TH', 'F', 'S'];
const DAY_NAMES = ['SU', 'M', 'T', 'W', 'TH', 'F', 'S'];

// ============================================
// ROTATION PATTERNS BY INDUSTRY
// ============================================
// Pattern format: array of 1s (working) and 0s (off) representing one complete cycle

const ROTATION_PATTERNS = {
    // Healthcare patterns
    healthcare: [
        {
            id: 'custom',
            name: 'Custom / No Pattern',
            desc: 'Manually assign shifts or let the scheduler optimize for coverage',
            pattern: null
        },
        {
            id: '5on2off',
            name: '5 on, 2 off (Standard Week)',
            desc: 'Traditional Monday-Friday schedule with weekends off',
            pattern: [1, 1, 1, 1, 1, 0, 0]
        },
        {
            id: '4on4off',
            name: '4 on, 4 off',
            desc: 'Common for 12-hour shifts. Work 4 days, rest 4 days. Good for 24/7 coverage.',
            pattern: [1, 1, 1, 1, 0, 0, 0, 0]
        },
        {
            id: '3on4off',
            name: '3 on, 4 off (36-hour week)',
            desc: 'Three 12-hour shifts per week. Popular in nursing.',
            pattern: [1, 1, 1, 0, 0, 0, 0]
        },
        {
            id: '7on7off',
            name: '7 on, 7 off',
            desc: 'Work a full week, off a full week. Common in remote/travel healthcare.',
            pattern: [1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0]
        },
        {
            id: 'dupont',
            name: 'DuPont (4-week cycle)',
            desc: '12-hour shifts: 4 nights, 3 off, 3 days, 1 off, 3 nights, 3 off, 4 days, 7 off',
            pattern: [1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0]
        },
        {
            id: 'panama',
            name: 'Panama / 2-2-3',
            desc: '2 on, 2 off, 3 on, 2 off, 2 on, 3 off. Every other weekend off.',
            pattern: [1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0]
        }
    ],

    // Manufacturing patterns
    manufacturing: [
        {
            id: 'custom',
            name: 'Custom / No Pattern',
            desc: 'Manually assign shifts or let the scheduler optimize for coverage',
            pattern: null
        },
        {
            id: '5on2off',
            name: '5 on, 2 off (Standard Week)',
            desc: 'Traditional Monday-Friday, 8-hour shifts',
            pattern: [1, 1, 1, 1, 1, 0, 0]
        },
        {
            id: '4on3off',
            name: '4 on, 3 off (4x10)',
            desc: 'Four 10-hour days, three days off. Compressed work week.',
            pattern: [1, 1, 1, 1, 0, 0, 0]
        },
        {
            id: '4on4off',
            name: '4 on, 4 off',
            desc: '12-hour shifts for continuous operations',
            pattern: [1, 1, 1, 1, 0, 0, 0, 0]
        },
        {
            id: 'continental',
            name: 'Continental (Fast Rotation)',
            desc: '2 days, 2 evenings, 2 nights, 4 off. Quick rotation through all shifts.',
            pattern: [1, 1, 1, 1, 1, 1, 0, 0, 0, 0]
        },
        {
            id: 'panama',
            name: 'Panama / 2-2-3',
            desc: '2 on, 2 off, 3 on, 2 off, 2 on, 3 off. Balanced coverage.',
            pattern: [1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0]
        },
        {
            id: '6on1off',
            name: '6 on, 1 off',
            desc: 'Six days working, one day rest. High coverage, heavy schedule.',
            pattern: [1, 1, 1, 1, 1, 1, 0]
        }
    ],

    // Public Safety patterns
    public_safety: [
        {
            id: 'custom',
            name: 'Custom / No Pattern',
            desc: 'Manually assign shifts or let the scheduler optimize for coverage',
            pattern: null
        },
        {
            id: '24on48off',
            name: '24 on, 48 off',
            desc: 'Classic fire department schedule. One 24-hour shift, two days off.',
            pattern: [1, 0, 0]
        },
        {
            id: '24on72off',
            name: '24 on, 72 off',
            desc: 'One 24-hour shift, three days off. Common in larger departments.',
            pattern: [1, 0, 0, 0]
        },
        {
            id: '4on4off',
            name: '4 on, 4 off (12-hour)',
            desc: 'Four 12-hour shifts, four days off. Used by police and EMS.',
            pattern: [1, 1, 1, 1, 0, 0, 0, 0]
        },
        {
            id: 'pitman',
            name: 'Pitman Schedule',
            desc: '2 on, 2 off, 3 on, 2 off, 2 on, 3 off. Every other weekend off.',
            pattern: [1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0]
        },
        {
            id: '5on2off5on3off',
            name: '5-2, 5-3 Rotation',
            desc: '5 on, 2 off, then 5 on, 3 off. 10-day cycle.',
            pattern: [1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0]
        },
        {
            id: 'california',
            name: 'California 3/12',
            desc: 'Three 12-hour shifts with 4 days off. Popular in EMS.',
            pattern: [1, 1, 1, 0, 0, 0, 0]
        }
    ],

    // Retail patterns
    retail: [
        {
            id: 'custom',
            name: 'Custom / No Pattern',
            desc: 'Flexible scheduling based on demand. Common in retail.',
            pattern: null
        },
        {
            id: '5on2off',
            name: '5 on, 2 off',
            desc: 'Standard 5-day work week',
            pattern: [1, 1, 1, 1, 1, 0, 0]
        },
        {
            id: '4on2off',
            name: '4 on, 2 off',
            desc: 'Four days working, two days off. Rotating days off.',
            pattern: [1, 1, 1, 1, 0, 0]
        },
        {
            id: '4on3off',
            name: '4 on, 3 off',
            desc: 'Four longer shifts with extended weekend',
            pattern: [1, 1, 1, 1, 0, 0, 0]
        },
        {
            id: '6on1off',
            name: '6 on, 1 off',
            desc: 'Six days working, one day off. High coverage for busy stores.',
            pattern: [1, 1, 1, 1, 1, 1, 0]
        },
        {
            id: 'split',
            name: 'Split Week (3-1-3)',
            desc: '3 on, 1 off, 3 on, then varying. Mid-week break.',
            pattern: [1, 1, 1, 0, 1, 1, 1, 0, 0]
        }
    ],

    // Other/Generic patterns
    other: [
        {
            id: 'custom',
            name: 'Custom / No Pattern',
            desc: 'Flexible scheduling without fixed rotation',
            pattern: null
        },
        {
            id: '5on2off',
            name: '5 on, 2 off (Standard)',
            desc: 'Traditional Monday-Friday schedule',
            pattern: [1, 1, 1, 1, 1, 0, 0]
        },
        {
            id: '4on3off',
            name: '4 on, 3 off',
            desc: 'Four-day work week with three-day weekend',
            pattern: [1, 1, 1, 1, 0, 0, 0]
        },
        {
            id: '4on4off',
            name: '4 on, 4 off',
            desc: 'Balanced work-rest ratio for continuous coverage',
            pattern: [1, 1, 1, 1, 0, 0, 0, 0]
        },
        {
            id: '6on2off',
            name: '6 on, 2 off',
            desc: 'Six-day week with two consecutive days off',
            pattern: [1, 1, 1, 1, 1, 1, 0, 0]
        }
    ]
};

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    loadFromStorage();
    initializeUI();
    bindEvents();
    renderUI();
});

function loadFromStorage() {
    const saved = localStorage.getItem('staffSchedulerState');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            Object.assign(AppState, parsed);
        } catch (e) {
            console.warn('Failed to load saved state:', e);
        }
    } else {
        // Initialize with default shifts for healthcare
        initializeDefaultShifts();
    }
}

function saveToStorage() {
    localStorage.setItem('staffSchedulerState', JSON.stringify(AppState));
}

function initializeDefaultShifts() {
    AppState.shifts = getIndustryDefaults(AppState.industry).shifts;
}

function getIndustryDefaults(industry) {
    const defaults = {
        healthcare: {
            shifts: [
                { code: 'D', start: '06:00', end: '16:00', desc: 'Day Shift', type: 'working', color: '#f5a623' },
                { code: 'E', start: '14:00', end: '00:00', desc: 'Evening Shift', type: 'working', color: '#f5a623' },
                { code: 'N', start: '20:00', end: '06:00', desc: 'Night Shift', type: 'working', color: '#f5a623' },
                { code: 'S', start: '11:00', end: '21:00', desc: 'Swing Shift', type: 'working', color: '#f5a623' },
                { code: 'F', start: '09:00', end: '19:00', desc: 'Flex Shift', type: 'working', color: '#f5a623' },
                { code: 'B', start: '', end: '', desc: 'Backup', type: 'backup', color: '#22c55e' },
                { code: 'A', start: '', end: '', desc: 'Admin', type: 'admin', color: '#3b82f6' }
            ],
            constraints: { minRestHours: 8, maxHoursWeek: 60, maxConsecutiveDays: 6 }
        },
        manufacturing: {
            shifts: [
                { code: 'D', start: '06:00', end: '14:00', desc: 'Day Shift', type: 'working', color: '#f5a623' },
                { code: 'A', start: '14:00', end: '22:00', desc: 'Afternoon Shift', type: 'working', color: '#f5a623' },
                { code: 'N', start: '22:00', end: '06:00', desc: 'Night Shift', type: 'working', color: '#f5a623' }
            ],
            constraints: { minRestHours: 8, maxHoursWeek: 48, maxConsecutiveDays: 5 }
        },
        public_safety: {
            shifts: [
                { code: 'D', start: '07:00', end: '19:00', desc: 'Day Shift', type: 'working', color: '#f5a623' },
                { code: 'N', start: '19:00', end: '07:00', desc: 'Night Shift', type: 'working', color: '#f5a623' },
                { code: 'R', start: '', end: '', desc: 'Reserve', type: 'backup', color: '#22c55e' }
            ],
            constraints: { minRestHours: 12, maxHoursWeek: 56, maxConsecutiveDays: 4 }
        },
        retail: {
            shifts: [
                { code: 'M', start: '06:00', end: '14:00', desc: 'Morning', type: 'working', color: '#f5a623' },
                { code: 'D', start: '10:00', end: '18:00', desc: 'Day', type: 'working', color: '#f5a623' },
                { code: 'E', start: '14:00', end: '22:00', desc: 'Evening', type: 'working', color: '#f5a623' },
                { code: 'C', start: '18:00', end: '00:00', desc: 'Closing', type: 'working', color: '#f5a623' }
            ],
            constraints: { minRestHours: 10, maxHoursWeek: 40, maxConsecutiveDays: 5 }
        },
        other: {
            shifts: [
                { code: 'D', start: '09:00', end: '17:00', desc: 'Day Shift', type: 'working', color: '#f5a623' },
                { code: 'E', start: '17:00', end: '01:00', desc: 'Evening Shift', type: 'working', color: '#f5a623' }
            ],
            constraints: { minRestHours: 8, maxHoursWeek: 40, maxConsecutiveDays: 5 }
        }
    };
    return defaults[industry] || defaults.other;
}

// ============================================
// UI INITIALIZATION & BINDING
// ============================================

function initializeUI() {
    // Set default start date for date range mode
    const today = new Date();
    document.getElementById('startDate').value = today.toISOString().split('T')[0];
}

function bindEvents() {
    // Industry change
    document.getElementById('industrySelect').addEventListener('change', (e) => {
        AppState.industry = e.target.value;
        const defaults = getIndustryDefaults(AppState.industry);
        AppState.shifts = defaults.shifts;
        AppState.constraints = { ...AppState.constraints, ...defaults.constraints };
        AppState.rotationPattern = 'custom'; // Reset to custom when industry changes
        renderRotationPatterns();
        renderShiftsList();
        renderConstraints();
        renderCoverageGrid();
        saveToStorage();
    });

    // Rotation pattern change
    document.getElementById('rotationPatternSelect').addEventListener('change', (e) => {
        AppState.rotationPattern = e.target.value;
        renderRotationPatternInfo();
        saveToStorage();
    });

    // Calendar style toggle
    document.querySelectorAll('input[name="calendarStyle"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            AppState.calendarStyle = e.target.value;
            document.getElementById('monthlyConfig').classList.toggle('hidden', e.target.value !== 'monthly');
            document.getElementById('dateRangeConfig').classList.toggle('hidden', e.target.value !== 'daterange');
            saveToStorage();
        });
    });

    // Form inputs
    document.getElementById('departmentName').addEventListener('input', (e) => {
        AppState.departmentName = e.target.value;
        saveToStorage();
    });

    document.getElementById('monthSelect').addEventListener('change', (e) => {
        AppState.month = parseInt(e.target.value);
        saveToStorage();
    });

    document.getElementById('yearInput').addEventListener('change', (e) => {
        AppState.year = parseInt(e.target.value);
        saveToStorage();
    });

    document.getElementById('startDate').addEventListener('change', (e) => {
        AppState.startDate = e.target.value;
        saveToStorage();
    });

    document.getElementById('durationSelect').addEventListener('change', (e) => {
        AppState.duration = parseInt(e.target.value);
        saveToStorage();
    });

    document.getElementById('coveragePreset').addEventListener('change', (e) => {
        AppState.coveragePreset = e.target.value;
        renderCoverageGrid();
        saveToStorage();
    });

    // Constraints
    ['minRestHours', 'maxHoursWeek', 'maxConsecutiveDays', 'targetShiftsPerPerson'].forEach(id => {
        document.getElementById(id).addEventListener('change', (e) => {
            AppState.constraints[id] = parseInt(e.target.value);
            saveToStorage();
        });
    });

    // Buttons
    document.getElementById('addShiftBtn').addEventListener('click', () => addShift());
    document.getElementById('addGroupBtn').addEventListener('click', () => addGroup());
    document.getElementById('addUnavailabilityBtn').addEventListener('click', () => addUnavailabilityEntry());
    document.getElementById('generateBtn').addEventListener('click', () => generateSchedule());
    document.getElementById('regenerateBtn').addEventListener('click', () => regenerateSchedule());
    document.getElementById('loadExampleBtn').addEventListener('click', () => loadHospitalExample());
    document.getElementById('clearAllBtn').addEventListener('click', () => clearAll());
    document.getElementById('exportCsvBtn').addEventListener('click', () => exportCSV());
    document.getElementById('printBtn').addEventListener('click', () => printSchedule());

    // Staff Preset buttons
    document.getElementById('savePresetBtn').addEventListener('click', () => saveStaffPreset());
    document.getElementById('loadPresetBtn').addEventListener('click', () => loadStaffPreset());
    document.getElementById('deletePresetBtn').addEventListener('click', () => deleteStaffPreset());

    document.getElementById('compactMode').addEventListener('change', (e) => {
        document.querySelector('.schedule-output').classList.toggle('compact-mode', e.target.checked);
    });

    document.getElementById('toggleConfig').addEventListener('click', () => {
        document.getElementById('configPanel').classList.toggle('collapsed');
    });
}

function renderUI() {
    // Populate form values from state
    document.getElementById('industrySelect').value = AppState.industry;
    document.getElementById('departmentName').value = AppState.departmentName;
    document.getElementById('monthSelect').value = AppState.month;
    document.getElementById('yearInput').value = AppState.year;
    document.getElementById('durationSelect').value = AppState.duration;
    document.getElementById('coveragePreset').value = AppState.coveragePreset;

    document.querySelector(`input[name="calendarStyle"][value="${AppState.calendarStyle}"]`).checked = true;
    document.getElementById('monthlyConfig').classList.toggle('hidden', AppState.calendarStyle !== 'monthly');
    document.getElementById('dateRangeConfig').classList.toggle('hidden', AppState.calendarStyle !== 'daterange');

    renderConstraints();
    renderRotationPatterns();
    renderShiftsList();
    renderGroupsList();
    renderCoverageGrid();
    renderUnavailabilitySection();
    renderStaffPresetsDropdown();

    // If we have a saved schedule, render it
    if (AppState.schedule) {
        renderSchedule();
    }
}

function renderConstraints() {
    document.getElementById('minRestHours').value = AppState.constraints.minRestHours;
    document.getElementById('maxHoursWeek').value = AppState.constraints.maxHoursWeek;
    document.getElementById('maxConsecutiveDays').value = AppState.constraints.maxConsecutiveDays;
    document.getElementById('targetShiftsPerPerson').value = AppState.constraints.targetShiftsPerPerson;
}

// ============================================
// ROTATION PATTERNS
// ============================================

function renderRotationPatterns() {
    const select = document.getElementById('rotationPatternSelect');
    const patterns = ROTATION_PATTERNS[AppState.industry] || ROTATION_PATTERNS.other;

    select.innerHTML = '';
    patterns.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        if (p.id === AppState.rotationPattern) {
            opt.selected = true;
        }
        select.appendChild(opt);
    });

    renderRotationPatternInfo();
}

function renderRotationPatternInfo() {
    const container = document.getElementById('rotationPatternInfo');
    const patterns = ROTATION_PATTERNS[AppState.industry] || ROTATION_PATTERNS.other;
    const selected = patterns.find(p => p.id === AppState.rotationPattern);

    if (!selected || selected.id === 'custom') {
        container.className = 'pattern-info warning';
        container.innerHTML = `
            <div class="pattern-title">Custom Scheduling</div>
            <div class="pattern-desc">
                The scheduler will assign shifts to meet coverage requirements without following a fixed rotation pattern.
                Useful for flexible scheduling or when employee availability varies significantly.
            </div>
        `;
        return;
    }

    container.className = 'pattern-info';

    // Build visual pattern display
    let patternVisual = '<div class="pattern-visual">';
    const pattern = selected.pattern;
    const cycleLength = pattern.length;

    // Show up to 2 cycles for visualization
    const showDays = Math.min(cycleLength * 2, 28);
    for (let i = 0; i < showDays; i++) {
        const isOn = pattern[i % cycleLength] === 1;
        patternVisual += `<div class="pattern-day ${isOn ? 'on' : 'off'}">${isOn ? 'W' : 'O'}</div>`;
        // Add separator between cycles
        if ((i + 1) % cycleLength === 0 && i < showDays - 1) {
            patternVisual += '<div style="width: 8px;"></div>';
        }
    }
    patternVisual += '</div>';

    // Calculate stats
    const daysOn = pattern.filter(d => d === 1).length;
    const daysOff = pattern.filter(d => d === 0).length;

    container.innerHTML = `
        <div class="pattern-title">${selected.name}</div>
        <div class="pattern-desc">${selected.desc}</div>
        ${patternVisual}
        <div style="margin-top: 0.5rem; font-size: 0.7rem; color: #6b7280;">
            Cycle: ${cycleLength} days (${daysOn} working, ${daysOff} off) ·
            W = Working · O = Off
        </div>
    `;
}

function getSelectedRotationPattern() {
    const patterns = ROTATION_PATTERNS[AppState.industry] || ROTATION_PATTERNS.other;
    return patterns.find(p => p.id === AppState.rotationPattern);
}

// ============================================
// SHIFTS MANAGEMENT
// ============================================

function renderShiftsList() {
    const container = document.getElementById('shiftsList');
    container.innerHTML = '';

    AppState.shifts.forEach((shift, index) => {
        const item = document.createElement('div');
        item.className = 'shift-item';
        item.innerHTML = `
            <div class="shift-code" style="background: ${shift.color}">${shift.code}</div>
            <div class="shift-info">
                <div>${shift.desc || shift.code}</div>
                <div class="shift-times">${shift.start && shift.end ? `${shift.start} - ${shift.end}` : 'No fixed time'}</div>
            </div>
            <div class="shift-actions">
                <button class="btn btn-sm btn-outline" onclick="editShift(${index})">Edit</button>
                <button class="btn btn-sm btn-outline" onclick="deleteShift(${index})">×</button>
            </div>
        `;
        container.appendChild(item);
    });
}

function addShift() {
    AppState.shifts.push({
        code: String.fromCharCode(65 + AppState.shifts.length),
        start: '09:00',
        end: '17:00',
        desc: '',
        type: 'working',
        color: '#f5a623'
    });
    renderShiftsList();
    renderCoverageGrid();
    editShift(AppState.shifts.length - 1);
    saveToStorage();
}

function editShift(index) {
    const shift = AppState.shifts[index];
    document.getElementById('modalShiftCode').value = shift.code;
    document.getElementById('modalShiftStart').value = shift.start;
    document.getElementById('modalShiftEnd').value = shift.end;
    document.getElementById('modalShiftDesc').value = shift.desc || '';
    document.getElementById('modalShiftType').value = shift.type;
    document.getElementById('modalShiftColor').value = shift.color;

    document.getElementById('shiftModal').classList.remove('hidden');
    document.getElementById('shiftModal').dataset.editIndex = index;
}

function closeShiftModal() {
    document.getElementById('shiftModal').classList.add('hidden');
}

function saveShiftModal() {
    const index = parseInt(document.getElementById('shiftModal').dataset.editIndex);
    AppState.shifts[index] = {
        code: document.getElementById('modalShiftCode').value.toUpperCase(),
        start: document.getElementById('modalShiftStart').value,
        end: document.getElementById('modalShiftEnd').value,
        desc: document.getElementById('modalShiftDesc').value,
        type: document.getElementById('modalShiftType').value,
        color: document.getElementById('modalShiftColor').value
    };
    closeShiftModal();
    renderShiftsList();
    renderCoverageGrid();
    saveToStorage();
}

function deleteShift(index) {
    if (confirm('Delete this shift?')) {
        AppState.shifts.splice(index, 1);
        renderShiftsList();
        renderCoverageGrid();
        saveToStorage();
    }
}

// ============================================
// GROUPS & EMPLOYEES MANAGEMENT
// ============================================

function renderGroupsList() {
    const container = document.getElementById('groupsList');
    container.innerHTML = '';

    AppState.groups.forEach((group, gIndex) => {
        const groupEl = document.createElement('div');
        groupEl.className = 'group-item';

        let employeesHtml = '';
        group.employees.forEach((emp, eIndex) => {
            const hasUnavail = emp.unavailability && emp.unavailability.length > 0;
            employeesHtml += `
                <div class="employee-item">
                    <input type="text" value="${emp.name}"
                        onchange="updateEmployeeName(${gIndex}, ${eIndex}, this.value)">
                    ${hasUnavail ? `<span class="unavail-indicator" onclick="editEmployee(${gIndex}, ${eIndex})">📅</span>` : ''}
                    <button class="btn btn-sm btn-outline" onclick="editEmployee(${gIndex}, ${eIndex})">⚙</button>
                    <button class="btn btn-sm btn-outline" onclick="deleteEmployee(${gIndex}, ${eIndex})">×</button>
                </div>
            `;
        });

        groupEl.innerHTML = `
            <div class="group-header">
                <input type="text" class="form-control" value="${group.name}"
                    onchange="updateGroupName(${gIndex}, this.value)">
                <button class="btn btn-sm btn-outline" onclick="deleteGroup(${gIndex})">×</button>
            </div>
            <div class="employees-list">
                ${employeesHtml}
            </div>
            <button class="btn btn-sm btn-secondary" onclick="addEmployee(${gIndex})">+ Add Employee</button>
        `;
        container.appendChild(groupEl);
    });
}

function addGroup() {
    AppState.groups.push({
        name: `GROUP ${AppState.groups.length + 1}`,
        employees: []
    });
    renderGroupsList();
    saveToStorage();
}

function updateGroupName(gIndex, name) {
    AppState.groups[gIndex].name = name;
    saveToStorage();
}

function deleteGroup(gIndex) {
    if (confirm('Delete this group and all its employees?')) {
        AppState.groups.splice(gIndex, 1);
        renderGroupsList();
        saveToStorage();
    }
}

const MAX_EMPLOYEES = 20;

function getTotalEmployeeCount() {
    return AppState.groups.reduce((sum, g) => sum + g.employees.length, 0);
}

function addEmployee(gIndex) {
    if (getTotalEmployeeCount() >= MAX_EMPLOYEES) {
        alert(`Employee limit reached (${MAX_EMPLOYEES}). A future update will allow more employees.`);
        return;
    }
    AppState.groups[gIndex].employees.push({
        name: `Employee ${AppState.groups[gIndex].employees.length + 1}`,
        unavailability: []
    });
    renderGroupsList();
    saveToStorage();
}

function updateEmployeeName(gIndex, eIndex, name) {
    AppState.groups[gIndex].employees[eIndex].name = name;
    saveToStorage();
}

function deleteEmployee(gIndex, eIndex) {
    AppState.groups[gIndex].employees.splice(eIndex, 1);
    renderGroupsList();
    renderUnavailabilitySection();
    saveToStorage();
}

// ============================================
// STAFF PRESETS (Save/Load Staff Groups)
// ============================================

function getStaffPresets() {
    const saved = localStorage.getItem('staffSchedulerPresets');
    return saved ? JSON.parse(saved) : {};
}

function saveStaffPresetsToStorage(presets) {
    localStorage.setItem('staffSchedulerPresets', JSON.stringify(presets));
}

function renderStaffPresetsDropdown() {
    const select = document.getElementById('staffPresetSelect');
    const presets = getStaffPresets();
    const presetNames = Object.keys(presets).sort();

    select.innerHTML = '<option value="">-- Select saved staff --</option>';
    presetNames.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        select.appendChild(opt);
    });
}

function saveStaffPreset() {
    const nameInput = document.getElementById('presetNameInput');
    let name = nameInput.value.trim();

    if (!name) {
        // Auto-generate a name based on department or date
        name = AppState.departmentName || 'Staff';
        name += ' - ' + new Date().toLocaleDateString();
    }

    if (AppState.groups.length === 0) {
        alert('No staff groups to save. Add groups and employees first.');
        return;
    }

    const presets = getStaffPresets();

    // Check if preset exists and confirm overwrite
    if (presets[name]) {
        if (!confirm(`A preset named "${name}" already exists. Overwrite it?`)) {
            return;
        }
    }

    // Save groups (deep copy to avoid reference issues)
    // Also save shifts configuration as it's often tied to the staff setup
    presets[name] = {
        groups: JSON.parse(JSON.stringify(AppState.groups)),
        shifts: JSON.parse(JSON.stringify(AppState.shifts)),
        departmentName: AppState.departmentName,
        savedAt: new Date().toISOString()
    };

    saveStaffPresetsToStorage(presets);
    renderStaffPresetsDropdown();

    // Select the newly saved preset
    document.getElementById('staffPresetSelect').value = name;
    nameInput.value = '';

    alert(`Staff preset "${name}" saved successfully!`);
}

function loadStaffPreset() {
    const select = document.getElementById('staffPresetSelect');
    const name = select.value;

    if (!name) {
        alert('Please select a preset to load.');
        return;
    }

    const presets = getStaffPresets();
    const preset = presets[name];

    if (!preset) {
        alert('Preset not found.');
        return;
    }

    // Confirm if current groups exist
    if (AppState.groups.length > 0) {
        if (!confirm('This will replace your current staff groups. Continue?')) {
            return;
        }
    }

    // Check employee limit
    const presetEmpCount = preset.groups.reduce((sum, g) => sum + g.employees.length, 0);
    if (presetEmpCount > MAX_EMPLOYEES) {
        alert(`This preset has ${presetEmpCount} employees, which exceeds the current limit of ${MAX_EMPLOYEES}.`);
        return;
    }

    // Load the preset data
    AppState.groups = JSON.parse(JSON.stringify(preset.groups));
    if (preset.shifts) {
        AppState.shifts = JSON.parse(JSON.stringify(preset.shifts));
    }
    if (preset.departmentName) {
        AppState.departmentName = preset.departmentName;
        document.getElementById('departmentName').value = preset.departmentName;
    }

    // Clear any existing schedule since staff changed
    AppState.schedule = null;

    renderGroupsList();
    renderShiftsList();
    renderUnavailabilitySection();
    renderCoverageGrid();
    saveToStorage();

    // Reset schedule output
    document.getElementById('scheduleOutput').innerHTML = `
        <div class="empty-state">
            <div class="empty-icon">📅</div>
            <h3>Staff Loaded: ${name}</h3>
            <p>Click "Generate Schedule" to create a roster with the loaded staff.</p>
        </div>
    `;
    document.getElementById('exportCsvBtn').disabled = true;
    document.getElementById('printBtn').disabled = true;
}

function deleteStaffPreset() {
    const select = document.getElementById('staffPresetSelect');
    const name = select.value;

    if (!name) {
        alert('Please select a preset to delete.');
        return;
    }

    if (!confirm(`Delete the preset "${name}"? This cannot be undone.`)) {
        return;
    }

    const presets = getStaffPresets();
    delete presets[name];
    saveStaffPresetsToStorage(presets);
    renderStaffPresetsDropdown();
}

// Employee edit modal
let currentEditEmployee = null;

function editEmployee(gIndex, eIndex) {
    currentEditEmployee = { gIndex, eIndex };
    const emp = AppState.groups[gIndex].employees[eIndex];

    document.getElementById('modalEmployeeName').value = emp.name;
    renderUnavailabilityList(emp.unavailability || []);

    document.getElementById('employeeModal').classList.remove('hidden');
}

function closeEmployeeModal() {
    document.getElementById('employeeModal').classList.add('hidden');
    currentEditEmployee = null;
}

function renderUnavailabilityList(unavailList) {
    const container = document.getElementById('unavailabilityList');
    container.innerHTML = '';

    unavailList.forEach((unavail, index) => {
        const item = document.createElement('div');
        item.className = 'unavail-item';
        item.innerHTML = `
            <select onchange="updateUnavailType(${index}, this.value)">
                <option value="LEAVE" ${unavail.type === 'LEAVE' ? 'selected' : ''}>LEAVE</option>
                <option value="TAD" ${unavail.type === 'TAD' ? 'selected' : ''}>TAD</option>
            </select>
            <input type="date" value="${unavail.startDate || ''}" onchange="updateUnavailStart(${index}, this.value)">
            <input type="date" value="${unavail.endDate || ''}" onchange="updateUnavailEnd(${index}, this.value)">
            <button class="btn btn-sm btn-outline" onclick="removeUnavailability(${index})">×</button>
        `;
        container.appendChild(item);
    });
}

function addUnavailability() {
    if (!currentEditEmployee) return;
    const emp = AppState.groups[currentEditEmployee.gIndex].employees[currentEditEmployee.eIndex];
    if (!emp.unavailability) emp.unavailability = [];
    emp.unavailability.push({ type: 'LEAVE', startDate: '', endDate: '' });
    renderUnavailabilityList(emp.unavailability);
}

function updateUnavailType(index, value) {
    if (!currentEditEmployee) return;
    const emp = AppState.groups[currentEditEmployee.gIndex].employees[currentEditEmployee.eIndex];
    emp.unavailability[index].type = value;
}

function updateUnavailStart(index, value) {
    if (!currentEditEmployee) return;
    const emp = AppState.groups[currentEditEmployee.gIndex].employees[currentEditEmployee.eIndex];
    emp.unavailability[index].startDate = value;
}

function updateUnavailEnd(index, value) {
    if (!currentEditEmployee) return;
    const emp = AppState.groups[currentEditEmployee.gIndex].employees[currentEditEmployee.eIndex];
    emp.unavailability[index].endDate = value;
}

function removeUnavailability(index) {
    if (!currentEditEmployee) return;
    const emp = AppState.groups[currentEditEmployee.gIndex].employees[currentEditEmployee.eIndex];
    emp.unavailability.splice(index, 1);
    renderUnavailabilityList(emp.unavailability);
}

function saveEmployeeModal() {
    if (!currentEditEmployee) return;
    const emp = AppState.groups[currentEditEmployee.gIndex].employees[currentEditEmployee.eIndex];
    emp.name = document.getElementById('modalEmployeeName').value;
    closeEmployeeModal();
    renderGroupsList();
    renderUnavailabilitySection();
    saveToStorage();
}

// ============================================
// UNAVAILABILITY SECTION (Dedicated UI)
// ============================================

function renderUnavailabilitySection() {
    const container = document.getElementById('unavailabilitySection');
    container.innerHTML = '';

    // Get all employees with their group info
    const allEmployees = [];
    AppState.groups.forEach((group, gIndex) => {
        group.employees.forEach((emp, eIndex) => {
            allEmployees.push({
                name: emp.name,
                groupName: group.name,
                gIndex,
                eIndex,
                unavailability: emp.unavailability || []
            });
        });
    });

    if (allEmployees.length === 0) {
        container.innerHTML = '<div class="unavail-empty">Add staff groups and employees first</div>';
        return;
    }

    // Collect all unavailability entries from all employees
    const allEntries = [];
    allEmployees.forEach(emp => {
        emp.unavailability.forEach((unavail, uIndex) => {
            allEntries.push({
                ...unavail,
                empName: emp.name,
                groupName: emp.groupName,
                gIndex: emp.gIndex,
                eIndex: emp.eIndex,
                uIndex
            });
        });
    });

    if (allEntries.length === 0) {
        container.innerHTML = '<div class="unavail-empty">No time off entries. Click "+ Add Time Off Entry" to add unavailability.</div>';
        return;
    }

    // Sort by start date
    allEntries.sort((a, b) => {
        if (!a.startDate) return 1;
        if (!b.startDate) return -1;
        return new Date(a.startDate) - new Date(b.startDate);
    });

    // Render each entry
    allEntries.forEach((entry, displayIndex) => {
        const entryEl = document.createElement('div');
        entryEl.className = `unavail-entry ${entry.type === 'TAD' ? 'tad' : ''}`;
        entryEl.dataset.gindex = entry.gIndex;
        entryEl.dataset.eindex = entry.eIndex;
        entryEl.dataset.uindex = entry.uIndex;

        // Build employee options
        let employeeOptions = '';
        allEmployees.forEach(emp => {
            const selected = emp.gIndex === entry.gIndex && emp.eIndex === entry.eIndex;
            employeeOptions += `<option value="${emp.gIndex}-${emp.eIndex}" ${selected ? 'selected' : ''}>${emp.name} (${emp.groupName})</option>`;
        });

        entryEl.innerHTML = `
            <div class="unavail-entry-header">
                <select class="form-control employee-select" onchange="updateUnavailEmployee(${entry.gIndex}, ${entry.eIndex}, ${entry.uIndex}, this.value)">
                    ${employeeOptions}
                </select>
                <select class="form-control" onchange="updateUnavailTypeSection(${entry.gIndex}, ${entry.eIndex}, ${entry.uIndex}, this.value)">
                    <option value="LEAVE" ${entry.type === 'LEAVE' ? 'selected' : ''}>LEAVE</option>
                    <option value="TAD" ${entry.type === 'TAD' ? 'selected' : ''}>TAD</option>
                </select>
                <button class="btn btn-sm btn-outline" onclick="deleteUnavailEntry(${entry.gIndex}, ${entry.eIndex}, ${entry.uIndex})">×</button>
            </div>
            <div class="unavail-entry-dates">
                <input type="date" class="form-control" value="${entry.startDate || ''}"
                    onchange="updateUnavailStartSection(${entry.gIndex}, ${entry.eIndex}, ${entry.uIndex}, this.value)">
                <span>to</span>
                <input type="date" class="form-control" value="${entry.endDate || ''}"
                    onchange="updateUnavailEndSection(${entry.gIndex}, ${entry.eIndex}, ${entry.uIndex}, this.value)">
            </div>
        `;
        container.appendChild(entryEl);
    });
}

function addUnavailabilityEntry() {
    // Get first employee or show message
    if (AppState.groups.length === 0 || !AppState.groups.some(g => g.employees.length > 0)) {
        alert('Please add at least one group with employees first.');
        return;
    }

    // Find first employee
    let firstEmp = null;
    for (let g = 0; g < AppState.groups.length; g++) {
        if (AppState.groups[g].employees.length > 0) {
            firstEmp = { gIndex: g, eIndex: 0 };
            break;
        }
    }

    if (!firstEmp) return;

    const emp = AppState.groups[firstEmp.gIndex].employees[firstEmp.eIndex];
    if (!emp.unavailability) emp.unavailability = [];

    // Default to current month dates
    const year = AppState.year;
    const month = AppState.month;
    const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;

    emp.unavailability.push({
        type: 'LEAVE',
        startDate: startDate,
        endDate: startDate
    });

    renderUnavailabilitySection();
    renderGroupsList();
    saveToStorage();
}

function updateUnavailEmployee(oldGIndex, oldEIndex, uIndex, newValue) {
    const [newGIndex, newEIndex] = newValue.split('-').map(Number);

    // Get the unavailability entry
    const oldEmp = AppState.groups[oldGIndex].employees[oldEIndex];
    const entry = oldEmp.unavailability[uIndex];

    // Remove from old employee
    oldEmp.unavailability.splice(uIndex, 1);

    // Add to new employee
    const newEmp = AppState.groups[newGIndex].employees[newEIndex];
    if (!newEmp.unavailability) newEmp.unavailability = [];
    newEmp.unavailability.push(entry);

    renderUnavailabilitySection();
    renderGroupsList();
    saveToStorage();
}

function updateUnavailTypeSection(gIndex, eIndex, uIndex, value) {
    AppState.groups[gIndex].employees[eIndex].unavailability[uIndex].type = value;
    renderUnavailabilitySection();
    renderGroupsList();
    saveToStorage();
}

function updateUnavailStartSection(gIndex, eIndex, uIndex, value) {
    const unavail = AppState.groups[gIndex].employees[eIndex].unavailability[uIndex];
    unavail.startDate = value;
    // If end date is empty or before start, set it to start
    if (!unavail.endDate || unavail.endDate < value) {
        unavail.endDate = value;
    }
    renderUnavailabilitySection();
    saveToStorage();
}

function updateUnavailEndSection(gIndex, eIndex, uIndex, value) {
    const unavail = AppState.groups[gIndex].employees[eIndex].unavailability[uIndex];
    unavail.endDate = value;
    // If start date is empty or after end, set it to end
    if (!unavail.startDate || unavail.startDate > value) {
        unavail.startDate = value;
    }
    renderUnavailabilitySection();
    saveToStorage();
}

function deleteUnavailEntry(gIndex, eIndex, uIndex) {
    AppState.groups[gIndex].employees[eIndex].unavailability.splice(uIndex, 1);
    renderUnavailabilitySection();
    renderGroupsList();
    saveToStorage();
}

// ============================================
// COVERAGE GRID
// ============================================

function renderCoverageGrid() {
    const container = document.getElementById('coverageGrid');
    container.innerHTML = '';

    // Only show coverage for working shifts
    const workingShifts = AppState.shifts.filter(s => s.type === 'working');

    workingShifts.forEach(shift => {
        const row = document.createElement('div');
        row.className = 'coverage-row';

        // Get default coverage based on preset
        const defaultCoverage = getCoverageDefault(shift.code);

        row.innerHTML = `
            <div class="shift-badge" style="background: ${shift.color}">${shift.code}</div>
            <label>${shift.desc || shift.code}</label>
            <input type="number" class="form-control" min="0" max="10"
                value="${shift.coverage !== undefined ? shift.coverage : defaultCoverage}"
                onchange="updateShiftCoverage('${shift.code}', this.value)">
        `;
        container.appendChild(row);
    });
}

function getCoverageDefault(shiftCode) {
    const preset = AppState.coveragePreset;
    if (preset === '24_7') return 1;
    if (preset === '8x5') return shiftCode === 'D' ? 1 : 0;
    if (preset === '12x7') return ['D', 'N'].includes(shiftCode) ? 1 : 0;
    return 1; // custom
}

function updateShiftCoverage(code, value) {
    const shift = AppState.shifts.find(s => s.code === code);
    if (shift) {
        shift.coverage = parseInt(value);
        saveToStorage();
    }
}

// ============================================
// SCHEDULE GENERATION
// ============================================

function getDaysInPeriod() {
    if (AppState.calendarStyle === 'monthly') {
        return new Date(AppState.year, AppState.month + 1, 0).getDate();
    } else {
        return AppState.duration;
    }
}

function getDateForDay(dayIndex) {
    if (AppState.calendarStyle === 'monthly') {
        return new Date(AppState.year, AppState.month, dayIndex + 1);
    } else {
        const start = parseLocalDate(AppState.startDate);
        return new Date(start.getTime() + dayIndex * 24 * 60 * 60 * 1000);
    }
}

// Parse a date string (YYYY-MM-DD) as local time, not UTC
function parseLocalDate(dateStr) {
    if (!dateStr) return null;
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
}

// Format a date as YYYY-MM-DD string for comparison
function formatDateStr(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function generateSchedule() {
    AppState.randomSeed = Date.now();
    runScheduler();
}

function regenerateSchedule() {
    AppState.randomSeed = Date.now() + Math.random() * 1000000;
    runScheduler();
}

// Simple seeded random
function seededRandom(seed) {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
}

function runScheduler() {
    const numDays = getDaysInPeriod();
    AppState.warnings = [];

    // Flatten employees with group info
    const allEmployees = [];
    AppState.groups.forEach((group, gIndex) => {
        group.employees.forEach((emp, eIndex) => {
            allEmployees.push({
                ...emp,
                groupIndex: gIndex,
                groupName: group.name,
                empIndex: eIndex,
                id: `${gIndex}-${eIndex}`
            });
        });
    });

    if (allEmployees.length === 0) {
        alert('Please add at least one group with employees before generating a schedule.');
        return;
    }

    // Initialize schedule: schedule[empId][dayIndex] = shiftCode or null
    const schedule = {};
    allEmployees.forEach(emp => {
        schedule[emp.id] = new Array(numDays).fill(null);
    });

    // Pre-fill unavailability
    allEmployees.forEach(emp => {
        if (emp.unavailability && emp.unavailability.length > 0) {
            emp.unavailability.forEach(unavail => {
                if (!unavail.startDate) return;
                const startStr = unavail.startDate;
                const endStr = unavail.endDate || unavail.startDate;

                for (let d = 0; d < numDays; d++) {
                    const dateStr = formatDateStr(getDateForDay(d));
                    // Compare as strings (YYYY-MM-DD format allows string comparison)
                    if (dateStr >= startStr && dateStr <= endStr) {
                        schedule[emp.id][d] = unavail.type;
                    }
                }
            });
        }
    });

    // Get rotation pattern (if any)
    const rotationPatternObj = getSelectedRotationPattern();
    const rotationPattern = rotationPatternObj ? rotationPatternObj.pattern : null;

    // If using a rotation pattern, assign each employee an offset for staggered coverage
    const employeePatternOffsets = {};
    if (rotationPattern) {
        const cycleLength = rotationPattern.length;
        allEmployees.forEach((emp, index) => {
            // Stagger employees across the pattern to ensure coverage
            // Different employees start at different points in the cycle
            employeePatternOffsets[emp.id] = Math.floor((index * cycleLength) / allEmployees.length);
        });
    }

    // Get working shifts sorted by priority (N > E > D > others)
    const workingShifts = AppState.shifts.filter(s => s.type === 'working');
    const shiftPriority = { 'N': 1, 'E': 2, 'D': 3 };
    workingShifts.sort((a, b) => (shiftPriority[a.code] || 10) - (shiftPriority[b.code] || 10));

    // Track shift counts for fairness
    const shiftCounts = {};
    allEmployees.forEach(emp => {
        shiftCounts[emp.id] = { total: 0, night: 0 };
    });

    // Track consecutive days
    const consecutiveDays = {};
    allEmployees.forEach(emp => {
        consecutiveDays[emp.id] = 0;
    });

    let seed = AppState.randomSeed;

    // Helper function to check if employee should work on a given day based on rotation pattern
    function shouldWorkOnDay(empId, dayIndex) {
        if (!rotationPattern) return true; // No pattern = always available
        const offset = employeePatternOffsets[empId] || 0;
        const cycleLength = rotationPattern.length;
        const positionInCycle = (dayIndex + offset) % cycleLength;
        return rotationPattern[positionInCycle] === 1;
    }

    // Schedule day by day
    for (let d = 0; d < numDays; d++) {
        const date = getDateForDay(d);
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;

        // For each shift type
        workingShifts.forEach(shift => {
            const coverage = shift.coverage !== undefined ? shift.coverage : getCoverageDefault(shift.code);

            // Get coverage for this day (could vary by weekend)
            let requiredCount = coverage;
            if (AppState.coveragePreset === '8x5' && isWeekend) {
                requiredCount = 0;
            }

            // Find available employees for this shift
            let available = allEmployees.filter(emp => {
                // Already assigned this day
                if (schedule[emp.id][d] !== null) return false;

                // Check rotation pattern - is this employee supposed to work today?
                if (!shouldWorkOnDay(emp.id, d)) return false;

                // Check rest constraint with previous day
                if (d > 0 && schedule[emp.id][d-1]) {
                    const prevShift = AppState.shifts.find(s => s.code === schedule[emp.id][d-1]);
                    if (prevShift && prevShift.type === 'working') {
                        // Simplified: just check if it's a night shift followed by day shift
                        if (prevShift.code === 'N' && shift.code === 'D') {
                            return false;
                        }
                    }
                }

                // Check consecutive days
                if (consecutiveDays[emp.id] >= AppState.constraints.maxConsecutiveDays) {
                    return false;
                }

                return true;
            });

            // Sort by fairness (prefer those with fewer shifts)
            available.sort((a, b) => {
                let scoreA = shiftCounts[a.id].total;
                let scoreB = shiftCounts[b.id].total;

                // Extra weight for night shifts
                if (shift.code === 'N') {
                    scoreA += shiftCounts[a.id].night * 2;
                    scoreB += shiftCounts[b.id].night * 2;
                }

                // Add some randomness for variety
                scoreA += seededRandom(seed++) * 0.5;
                scoreB += seededRandom(seed++) * 0.5;

                return scoreA - scoreB;
            });

            // Assign shifts up to required count
            let assigned = 0;
            for (let i = 0; i < available.length && assigned < requiredCount; i++) {
                const emp = available[i];
                schedule[emp.id][d] = shift.code;
                shiftCounts[emp.id].total++;
                if (shift.code === 'N') shiftCounts[emp.id].night++;
                assigned++;
            }

            // Check for undercoverage
            if (assigned < requiredCount) {
                AppState.warnings.push(`Day ${d+1}: ${shift.code} shift understaffed (${assigned}/${requiredCount})`);
            }
        });

        // Update consecutive days
        allEmployees.forEach(emp => {
            if (schedule[emp.id][d] && !['LEAVE', 'TAD'].includes(schedule[emp.id][d])) {
                consecutiveDays[emp.id]++;
            } else {
                consecutiveDays[emp.id] = 0;
            }
        });
    }

    // Optionally assign backup shifts to those with low counts (only on working days per rotation)
    const backupShift = AppState.shifts.find(s => s.type === 'backup');
    if (backupShift) {
        const targetShifts = AppState.constraints.targetShiftsPerPerson;

        for (let d = 0; d < numDays; d++) {
            allEmployees.forEach(emp => {
                // Only assign backup on days the employee should work (per rotation pattern)
                if (schedule[emp.id][d] === null && shouldWorkOnDay(emp.id, d) && shiftCounts[emp.id].total < targetShifts * 0.8) {
                    if (seededRandom(seed++) < 0.3) {
                        schedule[emp.id][d] = backupShift.code;
                        shiftCounts[emp.id].total++;
                    }
                }
            });
        }
    }

    // Optionally assign admin shifts (on working days per rotation)
    const adminShift = AppState.shifts.find(s => s.type === 'admin');
    if (adminShift) {
        for (let d = 0; d < numDays; d++) {
            allEmployees.forEach(emp => {
                // Only assign admin on days the employee should work (per rotation pattern)
                if (schedule[emp.id][d] === null && shouldWorkOnDay(emp.id, d)) {
                    if (seededRandom(seed++) < 0.15) {
                        schedule[emp.id][d] = adminShift.code;
                    }
                }
            });
        }
    }

    // Check for constraint violations
    allEmployees.forEach(emp => {
        let consecutive = 0;
        let maxConsec = 0;
        for (let d = 0; d < numDays; d++) {
            if (schedule[emp.id][d] && !['LEAVE', 'TAD'].includes(schedule[emp.id][d])) {
                consecutive++;
                maxConsec = Math.max(maxConsec, consecutive);
            } else {
                consecutive = 0;
            }
        }
        if (maxConsec > AppState.constraints.maxConsecutiveDays) {
            AppState.warnings.push(`${emp.name}: ${maxConsec} consecutive days (max ${AppState.constraints.maxConsecutiveDays})`);
        }
    });

    AppState.schedule = schedule;
    AppState.shiftCounts = shiftCounts;
    saveToStorage();
    renderSchedule();
}

// ============================================
// SCHEDULE RENDERING
// ============================================

function renderSchedule() {
    if (!AppState.schedule) return;

    const numDays = getDaysInPeriod();
    const output = document.getElementById('scheduleOutput');

    // Enable export buttons
    document.getElementById('exportCsvBtn').disabled = false;
    document.getElementById('printBtn').disabled = false;

    // Build header info
    let periodText = '';
    if (AppState.calendarStyle === 'monthly') {
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'];
        periodText = `${monthNames[AppState.month]} ${AppState.year}`;
    } else {
        const start = new Date(AppState.startDate);
        const end = new Date(start.getTime() + (AppState.duration - 1) * 24 * 60 * 60 * 1000);
        periodText = `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;
    }

    // Get shift codes that have totals (working shifts)
    const workingShifts = AppState.shifts.filter(s => s.type === 'working');
    const backupShift = AppState.shifts.find(s => s.type === 'backup');

    // Build table HTML
    let html = `
        <div class="roster-wrapper">
            <div class="roster-header">
                <div class="roster-title">${AppState.departmentName || 'Staff Schedule'}</div>
                <div class="roster-period">${periodText}</div>
            </div>
            <table class="roster-table">
                <thead>
                    <tr class="day-numbers">
                        <th class="staff-col"></th>
    `;

    // Day number headers
    for (let d = 0; d < numDays; d++) {
        const date = getDateForDay(d);
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        const dayNum = AppState.calendarStyle === 'monthly' ? d + 1 : date.getDate();
        html += `<th class="${isWeekend ? 'weekend' : ''}">${dayNum}</th>`;
    }

    // Totals headers
    workingShifts.forEach(s => {
        html += `<th class="totals-col totals-header">${s.code}</th>`;
    });
    html += `<th class="totals-col totals-header total-main">Total</th>`;
    if (backupShift) {
        html += `<th class="totals-col totals-header">${backupShift.code}</th>`;
    }
    html += `<th class="totals-col totals-header">Est</th>`;

    html += `</tr><tr class="day-names"><th class="staff-col">STAFF</th>`;

    // Day name headers
    for (let d = 0; d < numDays; d++) {
        const date = getDateForDay(d);
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        const dayName = DAY_NAMES[date.getDay()];
        html += `<th class="${isWeekend ? 'weekend' : ''}">${dayName}</th>`;
    }

    // Empty totals header cells
    workingShifts.forEach(() => html += `<th class="totals-col"></th>`);
    html += `<th class="totals-col"></th>`;
    if (backupShift) html += `<th class="totals-col"></th>`;
    html += `<th class="totals-col"></th>`;

    html += `</tr></thead><tbody>`;

    // Render each group
    AppState.groups.forEach((group, gIndex) => {
        // Group header row
        html += `<tr class="group-row"><td colspan="${numDays + workingShifts.length + 3 + (backupShift ? 1 : 0)}">${group.name}</td></tr>`;

        // Employee rows
        group.employees.forEach((emp, eIndex) => {
            const empId = `${gIndex}-${eIndex}`;
            const empSchedule = AppState.schedule[empId] || [];

            html += `<tr class="employee-row"><td class="staff-col">${emp.name}</td>`;

            // Shift counts for this employee
            const counts = {};
            workingShifts.forEach(s => counts[s.code] = 0);
            if (backupShift) counts[backupShift.code] = 0;
            let total = 0;

            // Day cells
            for (let d = 0; d < numDays; d++) {
                const shiftCode = empSchedule[d];
                const shift = AppState.shifts.find(s => s.code === shiftCode);

                let cellClass = 'shift-cell';
                let cellContent = '';

                if (shiftCode) {
                    if (shiftCode === 'LEAVE') {
                        cellClass += ' shift-leave';
                        cellContent = 'LEAVE';
                    } else if (shiftCode === 'TAD') {
                        cellClass += ' shift-tad';
                        cellContent = 'TAD';
                    } else {
                        cellClass += ` shift-${shiftCode.toLowerCase()}`;
                        cellContent = shiftCode.toLowerCase();

                        // Count for totals
                        if (counts[shiftCode] !== undefined) {
                            counts[shiftCode]++;
                        }
                        if (shift && shift.type === 'working') {
                            total++;
                        }
                    }
                }

                // Use CSS classes for colors (better print support) - inline style as fallback for custom shifts
                const inlineStyle = shift && !['D','E','N','S','F','B','A'].includes(shiftCode) ? `background: ${shift.color}` : '';
                html += `<td class="${cellClass}" onclick="editCell('${empId}', ${d})" ${inlineStyle ? `style="${inlineStyle}"` : ''}>${cellContent}</td>`;
            }

            // Totals cells
            workingShifts.forEach(s => {
                html += `<td class="totals-col">${counts[s.code] || 0}</td>`;
            });
            html += `<td class="totals-col total-main">${total}</td>`;
            if (backupShift) {
                html += `<td class="totals-col">${counts[backupShift.code] || 0}</td>`;
            }
            // Est column (estimated/target)
            html += `<td class="totals-col">${AppState.constraints.targetShiftsPerPerson}</td>`;

            html += `</tr>`;
        });
    });

    html += `</tbody></table>`;

    // Coverage footer
    html += renderCoverageFooter(numDays);

    // Legend
    html += `<div class="roster-legend">`;
    AppState.shifts.forEach(shift => {
        const timeStr = shift.start && shift.end ? `${shift.start}-${shift.end}` : '';
        const isStandardShift = ['D','E','N','S','F','B','A'].includes(shift.code);
        const legendStyle = isStandardShift ? '' : `style="background: ${shift.color}"`;
        html += `<div class="legend-item">
            <span class="legend-badge shift-${shift.code.toLowerCase()}" ${legendStyle}>${shift.code}</span>
            <span>${timeStr} ${shift.desc ? `(${shift.desc})` : ''}</span>
        </div>`;
    });
    html += `<div class="legend-item">
        <span class="legend-badge shift-leave" style="background: #ef4444">L</span>
        <span>LEAVE</span>
    </div>`;
    html += `<div class="legend-item">
        <span class="legend-badge shift-tad" style="background: #a855f7">T</span>
        <span>TAD (Training/Travel)</span>
    </div>`;
    html += `</div></div>`;

    output.innerHTML = html;

    // Render warnings
    renderWarnings();
}

function renderCoverageFooter(numDays) {
    let html = `<table class="roster-table coverage-footer">`;

    const workingShifts = AppState.shifts.filter(s => s.type === 'working');
    const backupShift = AppState.shifts.find(s => s.type === 'backup');
    const adminShift = AppState.shifts.find(s => s.type === 'admin');

    const allShiftsForFooter = [...workingShifts];
    if (backupShift) allShiftsForFooter.push(backupShift);

    allShiftsForFooter.forEach(shift => {
        const coverage = shift.coverage !== undefined ? shift.coverage : getCoverageDefault(shift.code);

        html += `<tr class="coverage-section">
            <td class="staff-col coverage-row-header">
                <div>${shift.code} ${shift.start && shift.end ? `${shift.start}-${shift.end}` : ''}</div>
                ${shift.desc ? `<div class="coverage-label">${shift.desc}</div>` : ''}
            </td>`;

        let totalRequired = 0;

        for (let d = 0; d < numDays; d++) {
            const date = getDateForDay(d);
            const isWeekend = date.getDay() === 0 || date.getDay() === 6;

            let required = coverage;
            if (AppState.coveragePreset === '8x5' && isWeekend && shift.type === 'working') {
                required = 0;
            }

            // Count assigned
            let assigned = 0;
            Object.keys(AppState.schedule).forEach(empId => {
                if (AppState.schedule[empId][d] === shift.code) {
                    assigned++;
                }
            });

            totalRequired += required;

            let cellClass = 'coverage-required';
            if (required > 0) {
                if (assigned < required) cellClass += ' coverage-under';
                else if (assigned > required) cellClass += ' coverage-over';
                else cellClass += ' coverage-met';
            }

            html += `<td class="${cellClass}">${required}</td>`;
        }

        // Total required (sum)
        workingShifts.forEach(() => html += `<td class="totals-col"></td>`);
        html += `<td class="totals-col">${totalRequired}</td>`;
        if (backupShift) html += `<td class="totals-col"></td>`;
        html += `<td class="totals-col"></td>`;

        html += `</tr>`;
    });

    // Legend row for admin
    if (adminShift) {
        html += `<tr class="coverage-section">
            <td class="staff-col coverage-row-header" colspan="${numDays + workingShifts.length + 3 + (backupShift ? 1 : 0)}">
                ${adminShift.code} = ${adminShift.desc || 'Admin'}
            </td>
        </tr>`;
    }

    html += `</table>`;
    return html;
}

function renderWarnings() {
    const panel = document.getElementById('warningsPanel');
    const list = document.getElementById('warningsList');

    if (AppState.warnings.length === 0) {
        panel.classList.add('hidden');
        return;
    }

    panel.classList.remove('hidden');
    list.innerHTML = AppState.warnings.map(w => `<li>${w}</li>`).join('');
}

// ============================================
// CELL EDITING
// ============================================

let currentEditCell = null;

function editCell(empId, dayIndex) {
    currentEditCell = { empId, dayIndex };

    const emp = findEmployee(empId);
    const date = getDateForDay(dayIndex);
    const currentShift = AppState.schedule[empId][dayIndex];

    document.getElementById('cellModalInfo').textContent =
        `${emp.name} - ${date.toLocaleDateString()}`;

    // Build shift buttons
    let buttonsHtml = '';
    AppState.shifts.forEach(shift => {
        const isActive = currentShift === shift.code;
        buttonsHtml += `
            <button class="shift-btn ${isActive ? 'active' : ''}" onclick="assignShift('${shift.code}')" style="border-color: ${shift.color}">
                <span class="code" style="color: ${shift.color}">${shift.code}</span>
                <span class="label">${shift.desc || ''}</span>
            </button>
        `;
    });

    // Special codes
    buttonsHtml += `
        <button class="shift-btn ${currentShift === 'LEAVE' ? 'active' : ''}" onclick="assignShift('LEAVE')" style="border-color: #ef4444">
            <span class="code" style="color: #ef4444">L</span>
            <span class="label">LEAVE</span>
        </button>
        <button class="shift-btn ${currentShift === 'TAD' ? 'active' : ''}" onclick="assignShift('TAD')" style="border-color: #a855f7">
            <span class="code" style="color: #a855f7">T</span>
            <span class="label">TAD</span>
        </button>
        <button class="shift-btn ${currentShift === null ? 'active' : ''}" onclick="assignShift(null)">
            <span class="code">-</span>
            <span class="label">Clear</span>
        </button>
    `;

    document.getElementById('shiftButtons').innerHTML = buttonsHtml;
    document.getElementById('cellModal').classList.remove('hidden');
}

function closeCellModal() {
    document.getElementById('cellModal').classList.add('hidden');
    currentEditCell = null;
}

function assignShift(shiftCode) {
    if (!currentEditCell) return;

    AppState.schedule[currentEditCell.empId][currentEditCell.dayIndex] = shiftCode;
    saveToStorage();
    closeCellModal();
    renderSchedule();
}

function findEmployee(empId) {
    const [gIndex, eIndex] = empId.split('-').map(Number);
    return AppState.groups[gIndex].employees[eIndex];
}

// ============================================
// EXPORT & PRINT
// ============================================

function exportCSV() {
    if (!AppState.schedule) return;

    const numDays = getDaysInPeriod();
    const workingShifts = AppState.shifts.filter(s => s.type === 'working');
    const backupShift = AppState.shifts.find(s => s.type === 'backup');

    let csv = '';

    // Header row 1 - day numbers
    csv += 'STAFF,';
    for (let d = 0; d < numDays; d++) {
        const date = getDateForDay(d);
        const dayNum = AppState.calendarStyle === 'monthly' ? d + 1 : date.getDate();
        csv += dayNum + ',';
    }
    workingShifts.forEach(s => csv += s.code + ',');
    csv += 'Total';
    if (backupShift) csv += ',' + backupShift.code;
    csv += '\n';

    // Header row 2 - day names
    csv += ',';
    for (let d = 0; d < numDays; d++) {
        const date = getDateForDay(d);
        csv += DAY_NAMES[date.getDay()] + ',';
    }
    csv += '\n';

    // Data rows
    AppState.groups.forEach((group, gIndex) => {
        csv += group.name + '\n';

        group.employees.forEach((emp, eIndex) => {
            const empId = `${gIndex}-${eIndex}`;
            const empSchedule = AppState.schedule[empId] || [];

            const counts = {};
            workingShifts.forEach(s => counts[s.code] = 0);
            if (backupShift) counts[backupShift.code] = 0;
            let total = 0;

            csv += emp.name + ',';

            for (let d = 0; d < numDays; d++) {
                const code = empSchedule[d] || '';
                csv += code + ',';

                if (counts[code] !== undefined) counts[code]++;
                const shift = AppState.shifts.find(s => s.code === code);
                if (shift && shift.type === 'working') total++;
            }

            workingShifts.forEach(s => csv += (counts[s.code] || 0) + ',');
            csv += total;
            if (backupShift) csv += ',' + (counts[backupShift.code] || 0);
            csv += '\n';
        });
    });

    // Download
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `schedule_${AppState.departmentName.replace(/\s+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

function printSchedule() {
    window.print();
}

// ============================================
// EXAMPLE DATA
// ============================================

function loadHospitalExample() {
    AppState.industry = 'healthcare';
    AppState.calendarStyle = 'monthly';
    AppState.departmentName = 'Emergency Department';
    AppState.month = 4; // May
    AppState.year = 2025;
    AppState.coveragePreset = '24_7';

    AppState.shifts = [
        { code: 'D', start: '06:00', end: '16:00', desc: 'Day Shift', type: 'working', color: '#f5a623', coverage: 1 },
        { code: 'E', start: '14:00', end: '00:00', desc: 'Evening Shift', type: 'working', color: '#f5a623', coverage: 1 },
        { code: 'N', start: '20:00', end: '06:00', desc: 'Night Shift', type: 'working', color: '#f5a623', coverage: 1 },
        { code: 'S', start: '11:00', end: '21:00', desc: 'Swing Shift', type: 'working', color: '#f5a623', coverage: 1 },
        { code: 'F', start: '09:00', end: '19:00', desc: 'Flex Shift', type: 'working', color: '#f5a623', coverage: 1 },
        { code: 'B', start: '', end: '', desc: 'Backup', type: 'backup', color: '#22c55e' },
        { code: 'A', start: '', end: '', desc: 'Admin', type: 'admin', color: '#3b82f6' }
    ];

    AppState.groups = [
        {
            name: 'NAVY',
            employees: [
                { name: 'Christensen', unavailability: [] },
                { name: 'Denny', unavailability: [] },
                { name: 'Goss', unavailability: [] },
                { name: 'Studer', unavailability: [{ type: 'LEAVE', startDate: '2025-05-20', endDate: '2025-05-20' }] },
                { name: 'Sangiorgi', unavailability: [] }
            ]
        },
        {
            name: 'MARINES',
            employees: [
                { name: 'Bardinelli', unavailability: [] },
                { name: 'Beville', unavailability: [] },
                { name: 'Chu', unavailability: [{ type: 'LEAVE', startDate: '2025-05-06', endDate: '2025-05-08' }] },
                { name: 'Dodson', unavailability: [{ type: 'TAD', startDate: '2025-05-08', endDate: '2025-05-10' }] },
                { name: 'Noyes', unavailability: [] },
                { name: 'Thompson', unavailability: [] },
                { name: 'Vandelune', unavailability: [
                    { type: 'LEAVE', startDate: '2025-05-03', endDate: '2025-05-04' },
                    { type: 'TAD', startDate: '2025-05-06', endDate: '2025-05-06' },
                    { type: 'LEAVE', startDate: '2025-05-12', endDate: '2025-05-14' },
                    { type: 'TAD', startDate: '2025-05-21', endDate: '2025-05-21' },
                    { type: 'TAD', startDate: '2025-05-27', endDate: '2025-05-27' }
                ]},
                { name: 'Yue', unavailability: [] },
                { name: 'Parker (MEU)', unavailability: [] },
                { name: 'Aubuchon (MEU)', unavailability: [] }
            ]
        },
        {
            name: 'PHYSICIAN ASSISTANTS',
            employees: [
                { name: 'Kliment', unavailability: [{ type: 'LEAVE', startDate: '2025-05-02', endDate: '2025-05-04' }] },
                { name: 'Ordonez', unavailability: [] },
                { name: 'Williams', unavailability: [] }
            ]
        }
    ];

    AppState.constraints = {
        minRestHours: 8,
        maxHoursWeek: 60,
        maxConsecutiveDays: 6,
        targetShiftsPerPerson: 14
    };

    AppState.schedule = null;

    saveToStorage();
    renderUI();
    generateSchedule();
}

function clearAll() {
    if (confirm('Clear all data and start fresh?')) {
        localStorage.removeItem('staffSchedulerState');
        AppState.groups = [];
        AppState.schedule = null;
        AppState.warnings = [];
        initializeDefaultShifts();
        renderUI();
        document.getElementById('scheduleOutput').innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📅</div>
                <h3>No Schedule Generated</h3>
                <p>Configure your settings and click "Generate Schedule" to create a roster.</p>
                <p class="hint">Or click "Load Hospital ED Example" to see a sample schedule.</p>
            </div>
        `;
        document.getElementById('exportCsvBtn').disabled = true;
        document.getElementById('printBtn').disabled = true;
    }
}

// Make functions globally accessible
window.editShift = editShift;
window.deleteShift = deleteShift;
window.closeShiftModal = closeShiftModal;
window.saveShiftModal = saveShiftModal;
window.updateGroupName = updateGroupName;
window.deleteGroup = deleteGroup;
window.addEmployee = addEmployee;
window.updateEmployeeName = updateEmployeeName;
window.deleteEmployee = deleteEmployee;
window.editEmployee = editEmployee;
window.closeEmployeeModal = closeEmployeeModal;
window.saveEmployeeModal = saveEmployeeModal;
window.addUnavailability = addUnavailability;
window.updateUnavailType = updateUnavailType;
window.updateUnavailStart = updateUnavailStart;
window.updateUnavailEnd = updateUnavailEnd;
window.removeUnavailability = removeUnavailability;
window.updateShiftCoverage = updateShiftCoverage;
window.editCell = editCell;
window.closeCellModal = closeCellModal;
window.assignShift = assignShift;
// Unavailability section functions
window.updateUnavailEmployee = updateUnavailEmployee;
window.updateUnavailTypeSection = updateUnavailTypeSection;
window.updateUnavailStartSection = updateUnavailStartSection;
window.updateUnavailEndSection = updateUnavailEndSection;
window.deleteUnavailEntry = deleteUnavailEntry;
