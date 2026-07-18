const apiBase = '/api';

const state = {
    notices: [],
    branches: [],
    banners: []
};
const WEBSITE_SCHOOL_ADDRESS = 'Main Kohat Road Jand';
let activeBannerIndex = 0;
let bannerTimer = null;
const desktopBannerMedia = window.matchMedia('(min-width: 768px)');

function text(value, fallback = '-') {
    const clean = String(value ?? '').trim();
    return clean || fallback;
}

function setText(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
}

async function getJson(endpoint, fallback) {
    try {
        const response = await fetch(`${apiBase}${endpoint}`);
        if (!response.ok) throw new Error(`Request failed: ${response.status}`);
        return await response.json();
    } catch (error) {
        console.warn(`Website data unavailable for ${endpoint}:`, error.message);
        return fallback;
    }
}

function renderNotices() {
    const container = document.getElementById('noticeList');
    if (!container) return;
    if (!state.notices.length) {
        container.innerHTML = '<p class="empty-state">No public notices available yet.</p>';
        return;
    }
    container.innerHTML = state.notices.slice(0, 5).map((notice) => `
        <div class="notice-item">
            <strong>${escapeHtml(text(notice.title, 'Notice'))}</strong>
            <span>${escapeHtml(text(notice.message, '')).slice(0, 180)}</span>
        </div>
    `).join('');
}

function renderContact() {
    const address = WEBSITE_SCHOOL_ADDRESS;
    setText('headerAddress', address);
    setText('contactAddress', address);
}

function renderBanners() {
    const section = document.getElementById('websiteBannerSection');
    const track = document.getElementById('websiteBannerTrack');
    const dots = document.getElementById('websiteBannerDots');
    if (!section || !track || !dots) return;

    if (!desktopBannerMedia.matches) {
        section.hidden = true;
        track.innerHTML = '';
        dots.innerHTML = '';
        if (bannerTimer) window.clearInterval(bannerTimer);
        bannerTimer = null;
        return;
    }

    const activeBanners = state.banners
        .filter((banner) => banner && banner.isActive !== false && text(banner.imageUrl, ''))
        .filter((banner) => String(banner.placement || '').trim().toLowerCase() === 'banner')
        .sort((a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0));

    if (!activeBanners.length) {
        section.hidden = true;
        track.innerHTML = '';
        dots.innerHTML = '';
        if (bannerTimer) window.clearInterval(bannerTimer);
        bannerTimer = null;
        return;
    }

    section.hidden = false;
    activeBannerIndex = Math.min(activeBannerIndex, activeBanners.length - 1);
    track.innerHTML = activeBanners.map((banner, index) => {
        const image = `<img src="${escapeHtml(banner.imageUrl)}" alt="${escapeHtml(text(banner.title, 'School banner'))}">`;
        const media = text(banner.linkUrl, '')
            ? `<a class="website-banner-media" href="${escapeHtml(banner.linkUrl)}">${image}</a>`
            : `<div class="website-banner-media">${image}</div>`;
        return `
            <article class="website-banner-slide${index === activeBannerIndex ? ' active' : ''}" data-banner-slide="${index}">
                ${media}
                <div class="website-banner-caption">
                    <h2>${escapeHtml(text(banner.title, 'PESS JAND'))}</h2>
                    ${text(banner.subtitle, '') ? `<p>${escapeHtml(banner.subtitle)}</p>` : ''}
                </div>
            </article>
        `;
    }).join('');

    dots.innerHTML = activeBanners.map((banner, index) => `
        <button type="button" class="${index === activeBannerIndex ? 'active' : ''}" data-banner-dot="${index}" aria-label="Show ${escapeHtml(text(banner.title, `banner ${index + 1}`))}"></button>
    `).join('');

    dots.querySelectorAll('[data-banner-dot]').forEach((button) => {
        button.addEventListener('click', () => {
            activeBannerIndex = Number(button.dataset.bannerDot || 0);
            renderBanners();
        });
    });

    if (bannerTimer) window.clearInterval(bannerTimer);
    if (activeBanners.length > 1) {
        bannerTimer = window.setInterval(() => {
            activeBannerIndex = (activeBannerIndex + 1) % activeBanners.length;
            renderBanners();
        }, 6000);
    }
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    }[char]));
}

async function loadWebsiteData() {
    const [noticePayload, branches, bannerPayload] = await Promise.all([
        getJson('/special-notices', { notices: [] }),
        getJson('/branches', []),
        getJson('/banners', { banners: [] })
    ]);

    state.notices = Array.isArray(noticePayload?.notices) ? noticePayload.notices : [];
    state.branches = Array.isArray(branches) ? branches : [];
    state.banners = Array.isArray(bannerPayload?.banners) ? bannerPayload.banners : (Array.isArray(bannerPayload) ? bannerPayload : []);

    renderBanners();
    renderNotices();
    renderContact();
}

function setupNavigation() {
    const toggle = document.querySelector('.menu-toggle');
    const links = document.getElementById('siteNavLinks');
    if (!toggle || !links) return;
    toggle.addEventListener('click', () => {
        const isOpen = links.classList.toggle('open');
        toggle.setAttribute('aria-expanded', String(isOpen));
    });
    links.querySelectorAll('a').forEach((link) => {
        link.addEventListener('click', () => {
            links.classList.remove('open');
            toggle.setAttribute('aria-expanded', 'false');
        });
    });
}

function setupInquiryForm() {
    const form = document.getElementById('inquiryForm');
    if (!form) return;
    const statusNode = document.getElementById('inquiryFormStatus');
    const setStatus = (message, isError = false) => {
        if (!statusNode) return;
        statusNode.textContent = message;
        statusNode.classList.toggle('error', Boolean(isError));
    };

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submitButton = form.querySelector('button[type="submit"]');
        const payload = {
            studentName: text(document.getElementById('inquiryStudentName')?.value, ''),
            parentName: text(document.getElementById('inquiryParentName')?.value, ''),
            className: text(document.getElementById('inquiryClass')?.value, ''),
            phone: text(document.getElementById('inquiryPhone')?.value, ''),
            email: text(document.getElementById('inquiryEmail')?.value, ''),
            campus: text(document.getElementById('inquiryCampus')?.value, ''),
            studentAge: text(document.getElementById('inquiryStudentAge')?.value, ''),
            previousSchool: text(document.getElementById('inquiryPreviousSchool')?.value, ''),
            address: text(document.getElementById('inquiryAddress')?.value, ''),
            message: text(document.getElementById('inquiryMessage')?.value, '')
        };

        if (!payload.studentName || !payload.parentName || !payload.className || !payload.phone) {
            setStatus('Student name, parent name, class, and phone are required.', true);
            return;
        }

        try {
            if (submitButton) {
                submitButton.disabled = true;
                submitButton.innerHTML = '<i data-lucide="loader-circle"></i> Submitting...';
                if (window.lucide) window.lucide.createIcons();
            }
            setStatus('Submitting admission application...');
            const response = await fetch(`${apiBase}/online-admissions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || result.success === false) {
                throw new Error(result.message || 'Application could not be submitted.');
            }
            form.reset();
            setStatus('Application submitted. School office will contact you soon.');
        } catch (error) {
            setStatus(error.message || 'Application could not be submitted.', true);
        } finally {
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.innerHTML = '<i data-lucide="send"></i> Submit Application';
                if (window.lucide) window.lucide.createIcons();
            }
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    setupInquiryForm();
    loadWebsiteData();
    if (window.lucide) window.lucide.createIcons();
});

if (desktopBannerMedia.addEventListener) {
    desktopBannerMedia.addEventListener('change', renderBanners);
} else if (desktopBannerMedia.addListener) {
    desktopBannerMedia.addListener(renderBanners);
}
