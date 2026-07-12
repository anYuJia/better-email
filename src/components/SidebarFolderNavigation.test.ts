import { describe, expect, it } from 'vitest';
import type { Folder, FolderRole } from '../app/types';
import { folderPreferenceKey } from '../app/appConfig';
import { sidebarFolderGroups } from './SidebarFolderNavigation';

function folder(id: number, role: FolderRole, name: string = role): Folder {
  return {
    id,
    account_id: 1,
    name,
    role,
    unread_count: 0,
    is_virtual: false,
  };
}

describe('sidebarFolderGroups', () => {
  it('orders system folders first and keeps custom folders in input order', () => {
    const alpha = folder(11, 'custom:alpha', 'Alpha');
    const folders = [
      alpha,
      folder(3, 'trash'),
      folder(1, 'inbox'),
      folder(4, 'custom:beta', 'Beta'),
      folder(2, 'sent'),
      folder(5, 'archive'),
    ];

    const groups = sidebarFolderGroups(folders, new Set());

    expect(groups.primaryFolders.map((item) => item.id)).toEqual([1, 2, 5]);
    expect(groups.moreFolders.map((item) => item.id)).toEqual([3, 11, 4]);
  });

  it('promotes favorite non-primary folders without duplicating primary folders', () => {
    const custom = folder(10, 'custom:clients', 'Clients');
    const trash = folder(3, 'trash');
    const inbox = folder(1, 'inbox');
    const favoriteKeys = new Set([
      folderPreferenceKey(custom),
      folderPreferenceKey(trash),
      folderPreferenceKey(inbox),
    ]);

    const groups = sidebarFolderGroups([custom, inbox, trash], favoriteKeys);

    expect(groups.primaryFolders.map((item) => item.id)).toEqual([1, 3, 10]);
    expect(groups.moreFolders).toEqual([]);
  });

  it('keeps duplicate primary folders ahead of favorite custom folders', () => {
    const favoriteCustom = folder(20, 'custom:vip', 'VIP');
    const duplicateInbox = folder(2, 'inbox', 'Second inbox');
    const groups = sidebarFolderGroups([
      favoriteCustom,
      folder(1, 'inbox'),
      duplicateInbox,
    ], new Set([folderPreferenceKey(favoriteCustom)]));

    expect(groups.primaryFolders.map((item) => item.id)).toEqual([1, 2, 20]);
  });
});
