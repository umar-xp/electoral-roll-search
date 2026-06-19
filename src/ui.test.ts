/**
 * Unit tests for src/ui.ts — DOM utility functions.
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { showBanner, hideBanner, showProgress, hideProgress, showSkeletonResults, hideSkeletonResults, debounce, safeInnerHTML, escAttr } from './ui';

// Setup a minimal DOM environment
function createDOM() {
  document.body.innerHTML = `
    <div id="div-status-banner" style="display:none"></div>
    <div id="div-search-progress" style="display:none">
      <span class="progress-text"></span>
      <div class="progress-bar-fill" style="width:0%"></div>
    </div>
    <div id="div-db-results"></div>
  `;
}

describe('showBanner', () => {
  beforeEach(createDOM);

  it('shows green banner', () => {
    showBanner('green', 'Success!');
    const banner = document.getElementById('div-status-banner')!;
    expect(banner.style.display).toBe('block');
    expect(banner.className).toContain('alert-success');
    expect(banner.textContent).toBe('Success!');
  });

  it('shows yellow banner', () => {
    showBanner('yellow', 'Warning');
    const banner = document.getElementById('div-status-banner')!;
    expect(banner.className).toContain('alert-warning');
  });

  it('shows red/error banner', () => {
    showBanner('red', 'Error!');
    const banner = document.getElementById('div-status-banner')!;
    expect(banner.className).toContain('alert-error');

    showBanner('error', 'Error2!');
    expect(banner.className).toContain('alert-error');
  });

  it('falls back to alert-info for unknown type', () => {
    showBanner('unknown' as any, 'Info');
    const banner = document.getElementById('div-status-banner')!;
    expect(banner.className).toContain('alert-info');
  });

  it('does nothing if banner element is missing', () => {
    document.body.innerHTML = '';
    expect(() => showBanner('green', 'hi')).not.toThrow();
  });
});

describe('hideBanner', () => {
  beforeEach(createDOM);

  it('hides the banner', () => {
    const banner = document.getElementById('div-status-banner')!;
    banner.style.display = 'block';
    hideBanner();
    expect(banner.style.display).toBe('none');
  });

  it('does nothing if banner element is missing', () => {
    document.body.innerHTML = '';
    expect(() => hideBanner()).not.toThrow();
  });
});

describe('showProgress', () => {
  beforeEach(createDOM);

  it('shows progress bar with text', () => {
    showProgress('Loading...', 50);
    const div = document.getElementById('div-search-progress')!;
    expect(div.style.display).toBe('block');
    expect(div.querySelector('.progress-text')!.textContent).toBe('Loading...');
    expect((div.querySelector('.progress-bar-fill') as HTMLElement).style.width).toBe('50%');
  });

  it('shows progress without percentage', () => {
    showProgress('Searching...');
    const div = document.getElementById('div-search-progress')!;
    expect(div.style.display).toBe('block');
    expect(div.querySelector('.progress-text')!.textContent).toBe('Searching...');
  });

  it('handles missing .progress-text element', () => {
    document.body.innerHTML = '<div id="div-search-progress"><div class="progress-bar-fill"></div></div>';
    expect(() => showProgress('test', 50)).not.toThrow();
  });

  it('handles missing .progress-bar-fill element', () => {
    document.body.innerHTML = '<div id="div-search-progress"><span class="progress-text"></span></div>';
    showProgress('test', 75);
    expect(document.querySelector('.progress-text')!.textContent).toBe('test');
  });

  it('does nothing if div missing', () => {
    document.body.innerHTML = '';
    expect(() => showProgress('x', 10)).not.toThrow();
  });
});

describe('hideProgress', () => {
  beforeEach(createDOM);

  it('hides the progress bar', () => {
    const div = document.getElementById('div-search-progress')!;
    div.style.display = 'block';
    hideProgress();
    expect(div.style.display).toBe('none');
  });

  it('does nothing if div missing', () => {
    document.body.innerHTML = '';
    expect(() => hideProgress()).not.toThrow();
  });
});

describe('showSkeletonResults', () => {
  beforeEach(createDOM);

  it('renders skeleton cards', () => {
    showSkeletonResults(3);
    const container = document.getElementById('div-db-results')!;
    const skeletons = container.querySelectorAll('.skeleton-card');
    expect(skeletons.length).toBe(3);
  });

  it('renders zero skeleton cards', () => {
    showSkeletonResults(0);
    const container = document.getElementById('div-db-results')!;
    const skeletons = container.querySelectorAll('.skeleton-card');
    expect(skeletons.length).toBe(0);
  });

  it('does nothing if container missing', () => {
    document.body.innerHTML = '';
    expect(() => showSkeletonResults(5)).not.toThrow();
  });
});

describe('hideSkeletonResults', () => {
  beforeEach(createDOM);

  it('removes skeleton cards', () => {
    showSkeletonResults(2);
    const container = document.getElementById('div-db-results')!;
    expect(container.querySelectorAll('.skeleton-card').length).toBe(2);
    hideSkeletonResults();
    expect(container.querySelectorAll('.skeleton-card').length).toBe(0);
  });

  it('does nothing when no skeleton cards exist', () => {
    expect(() => hideSkeletonResults()).not.toThrow();
  });
});

describe('debounce', () => {
  it('calls function after delay', async () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 200);
    debounced();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('resets timer on subsequent calls', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced();
    vi.advanceTimersByTime(50);
    debounced(); // reset timer
    vi.advanceTimersByTime(50);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('passes arguments to the function', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced('arg1', 'arg2');
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
    vi.useRealTimers();
  });
});

describe('safeInnerHTML', () => {
  beforeEach(createDOM);

  it('sets innerHTML on element', () => {
    const el = document.createElement('div');
    safeInnerHTML(el, '<span>Hello</span>');
    expect(el.innerHTML).toBe('<span>Hello</span>');
  });
});

describe('escAttr', () => {
  it('encodes special characters', () => {
    expect(escAttr('hello world')).toBe('hello%20world');
    expect(escAttr('a&b=c')).toBe('a%26b%3Dc');
  });

  it('returns empty string for empty input', () => {
    expect(escAttr('')).toBe('');
  });

  it('handles Kannada text', () => {
    const encoded = escAttr('ಮಂಜುನಾಥ');
    expect(decodeURIComponent(encoded)).toBe('ಮಂಜುನಾಥ');
  });
});
