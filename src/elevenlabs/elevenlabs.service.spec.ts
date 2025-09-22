import { Test, TestingModule } from '@nestjs/testing';
import { ElevenlabsService } from './elevenlabs.service';

describe('ElevenlabsService', () => {
  let service: ElevenlabsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ElevenlabsService],
    }).compile();

    service = module.get<ElevenlabsService>(ElevenlabsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
