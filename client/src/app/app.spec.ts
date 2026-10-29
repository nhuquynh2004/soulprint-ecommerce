import { TestBed } from '@angular/core/testing';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { App } from './app';
import { Header } from './layout/header/header';
import { Footer } from './layout/footer/footer';
import { Icon } from './shared/icon/icon';
import { Toasts } from './shared/toasts/toasts';
import { LoginPrompt } from './shared/login-prompt/login-prompt';
import { Dialog } from './shared/dialog/dialog';
import { ChatWidget } from './layout/chat-widget/chat-widget';
import { ConfirmHost } from './shared/confirm-host/confirm-host';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RouterModule.forRoot([]), FormsModule],
      providers: [provideHttpClient(), provideHttpClientTesting()],
      // Test AOT không đọc được phạm vi của NgModule import vào, nên khai báo trực tiếp component con
      declarations: [App, Header, Footer, Icon, Toasts, LoginPrompt, Dialog, ChatWidget, ConfirmHost],
    }).compileComponents();
  });

  it('có header, vùng nội dung chính và footer', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-header')).toBeTruthy();
    expect(el.querySelector('main#noi-dung router-outlet')).toBeTruthy();
    expect(el.querySelector('app-footer')).toBeTruthy();
  });
});
